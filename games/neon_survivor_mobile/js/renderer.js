// renderer.js — SV.Renderer: 相机 + 视差背景 + 霓虹辉光(离屏缓存,非实时 shadowBlur)+ 视口剔除。
(function () {
  "use strict";
  const SV = window.SV;
  const U = SV.Util;
  const C = SV.Config.CONST;
  const COL = SV.Config.COLORS;

  let canvas, ctx;
  let dpr = 1, cssW = 0, cssH = 0;
  const cam = { x: 0, y: 0, zoom: 1 };
  let view = { l: 0, t: 0, r: 0, b: 0 };

  // 离屏缓存
  const glowCache = new Map();     // color -> 128x128 辉光画布
  let gridPattern = null;
  const stars = [];
  let starColor = "#cfe8ff";

  function makeGlow(color) {
    const S = 128;
    const cv = document.createElement("canvas"); cv.width = S; cv.height = S;
    const g = cv.getContext("2d");
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, color);
    grd.addColorStop(0.35, color);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = 0.9;
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    return cv;
  }
  function glow(color) {
    let g = glowCache.get(color);
    if (!g) { g = makeGlow(color); glowCache.set(color, g); }
    return g;
  }

  // 将角色色向白色提亮，供玩家朝向箭头复用本体的霓虹层次。
  function brighten(color, amount) {
    const m = /^#([0-9a-f]{6})$/i.exec(color || "");
    if (!m) return color;
    const n = parseInt(m[1], 16), t = amount == null ? 0.25 : amount;
    function ch(v) { return Math.round(v + (255 - v) * t).toString(16).padStart(2, "0"); }
    return "#" + ch((n >> 16) & 255) + ch((n >> 8) & 255) + ch(n & 255);
  }

  // 按形状构造路径(以 r 缩放)。敌人/玩家外观统一走这里。
  function drawShapePath(ctx, x, y, r, shape) {
    ctx.beginPath();
    if (shape === "triangle") {
      for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + k * U.TAU / 3; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.closePath();
    } else if (shape === "square") {
      ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
    } else if (shape === "diamond") {
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
    } else if (shape === "hex") {
      for (let k = 0; k < 6; k++) { const a = k * U.TAU / 6; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.closePath();
    } else if (shape === "pentagon") {
      for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * U.TAU / 5; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.closePath();
    } else if (shape === "star") {
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5; const rr = (k & 1) ? r * 0.45 : r; const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.closePath();
    } else if (shape === "cross") {
      const t = r * 0.35;
      ctx.moveTo(x - t, y - r); ctx.lineTo(x + t, y - r); ctx.lineTo(x + t, y - t); ctx.lineTo(x + r, y - t); ctx.lineTo(x + r, y + t); ctx.lineTo(x + t, y + t); ctx.lineTo(x + t, y + r); ctx.lineTo(x - t, y + r); ctx.lineTo(x - t, y + t); ctx.lineTo(x - r, y + t); ctx.lineTo(x - r, y - t); ctx.lineTo(x - t, y - t); ctx.closePath();
    } else if (shape === "blob") {
      for (let k = 0; k < 8; k++) { const a = k * U.TAU / 8; const rr = r * (k & 1 ? 0.75 : 1.05); const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, U.TAU);
    }
  }

  // 减速:把敌人轮廓打散成稳定但不规则的冰壳碎片；不使用规则虚线或平滑圆弧。
  function drawSlowFracture(g, e, shape, pulse, reduced) {
    const r=e.r+5,seed=(e.id||0)*17+13,verts=[];
    const rnd=function(k){const v=Math.sin(seed*12.9898+k*78.233)*43758.5453;return v-Math.floor(v);};
    const add=function(a,rr){verts.push({x:e.x+Math.cos(a)*rr,y:e.y+Math.sin(a)*rr});};
    if(shape==="square"){verts.push({x:e.x-r*.92,y:e.y-r*.92},{x:e.x+r*.92,y:e.y-r*.92},{x:e.x+r*.92,y:e.y+r*.92},{x:e.x-r*.92,y:e.y+r*.92});}
    else if(shape==="diamond"){add(-Math.PI/2,r);add(0,r);add(Math.PI/2,r);add(Math.PI,r);}
    else if(shape==="triangle"){for(let k=0;k<3;k++)add(-Math.PI/2+k*U.TAU/3,r);}
    else if(shape==="pentagon"||shape==="hex"){const n=shape==="pentagon"?5:6;for(let k=0;k<n;k++)add(-Math.PI/2+k*U.TAU/n,r);}
    else if(shape==="star"){for(let k=0;k<10;k++)add(-Math.PI/2+k*Math.PI/5,(k&1)?r*.5:r);}
    else if(shape==="cross"){const t=r*.36;verts.push({x:e.x-t,y:e.y-r},{x:e.x+t,y:e.y-r},{x:e.x+t,y:e.y-t},{x:e.x+r,y:e.y-t},{x:e.x+r,y:e.y+t},{x:e.x+t,y:e.y+t},{x:e.x+t,y:e.y+r},{x:e.x-t,y:e.y+r},{x:e.x-t,y:e.y+t},{x:e.x-r,y:e.y+t},{x:e.x-r,y:e.y-t},{x:e.x-t,y:e.y-t});}
    else {const n=reduced?13:19;for(let k=0;k<n;k++)add(-.2+k*U.TAU/n,r*(.82+rnd(k)*.2));}
    g.save();g.strokeStyle="#78e8ff";g.fillStyle="#c8f4ff";g.globalAlpha=.72*pulse;g.lineWidth=1.5;g.lineCap="butt";g.lineJoin="miter";
    for(let i=0;i<verts.length;i++){
      const a=verts[i],b=verts[(i+1)%verts.length],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
      const pieces=Math.max(1,Math.ceil(len/(reduced?11:8)));
      for(let j=0;j<pieces;j++){
        const q=i*7+j,base0=j/pieces,base1=(j+1)/pieces;
        if(rnd(q+31)<(reduced?.27:.34))continue;
        const t0=base0+(base1-base0)*(.05+rnd(q+1)*.24),t1=base1-(base1-base0)*(.08+rnd(q+2)*.27);
        const kick0=(rnd(q+3)-.5)*5,kick1=(rnd(q+4)-.5)*6;
        const x0=a.x+dx*t0+nx*kick0,y0=a.y+dy*t0+ny*kick0,x1=a.x+dx*t1+nx*kick1,y1=a.y+dy*t1+ny*kick1;
        const mx=(x0+x1)*.5+nx*(rnd(q+5)-.35)*4,my=(y0+y1)*.5+ny*(rnd(q+5)-.35)*4;
        g.beginPath();g.moveTo(x0,y0);g.lineTo(mx,my);g.lineTo(x1,y1);g.stroke();
        if(!reduced&&rnd(q+6)>.67){const vx=mx-e.x,vy=my-e.y,vl=Math.hypot(vx,vy)||1,ox=vx/vl,oy=vy/vl,tx=-oy,ty=ox,sl=3+rnd(q+7)*6,sw=1+rnd(q+8)*2.6;g.globalAlpha=(.42+rnd(q+9)*.35)*pulse;g.beginPath();g.moveTo(mx+tx*sw,my+ty*sw);g.lineTo(mx+ox*sl+tx*(rnd(q+10)-.5)*3,my+oy*sl+ty*(rnd(q+10)-.5)*3);g.lineTo(mx-tx*sw*.65,my-ty*sw*.65);g.closePath();g.fill();g.globalAlpha=.72*pulse;}
      }
    }
    g.restore();
  }

  // 克制的内部纹章：只用细线/小圆，不改变敌人的基础几何轮廓。
  function drawEnemyPattern(g, x, y, r, pattern, time, reduced, boss) {
    if (!pattern) return;
    const pulse = reduced ? 1 : 0.88 + 0.12 * Math.sin((time || 0) * 2.4);
    const rot = (!reduced && boss) ? (time || 0) * 0.18 : 0;
    g.save(); g.translate(x, y); if (rot) g.rotate(rot);
    g.globalAlpha = (boss ? 0.76 : 0.58) * pulse;
    g.strokeStyle = "rgba(255,255,255,0.92)"; g.fillStyle = "rgba(255,255,255,0.86)";
    g.lineWidth = Math.max(1, r * (boss ? 0.075 : 0.085));
    g.lineCap = "round"; g.lineJoin = "round";
    function line(a,b,c,d){g.beginPath();g.moveTo(a*r,b*r);g.lineTo(c*r,d*r);g.stroke();}
    function dot(a,b,s){g.beginPath();g.arc(a*r,b*r,r*s,0,U.TAU);g.fill();}
    function poly(n, rr, phase){g.beginPath();for(let k=0;k<n;k++){const a=(phase||0)+k*U.TAU/n,px=Math.cos(a)*r*rr,py=Math.sin(a)*r*rr;k?g.lineTo(px,py):g.moveTo(px,py);}g.closePath();g.stroke();}
    if(pattern==="barrel"){line(-.34,0,.28,0);dot(.36,0,.1);}
    else if(pattern==="sight"){line(-.46,0,.46,0);line(0,-.22,0,.22);dot(0,0,.07);}
    else if(pattern==="crack"){line(-.12,-.45,.03,-.12);line(.03,-.12,-.24,.18);line(.03,-.12,.3,.26);}
    else if(pattern==="cells"||pattern==="honey"){const n=pattern==="honey"?6:3;for(let k=0;k<n;k++){const a=k*U.TAU/n;dot(Math.cos(a)*.3,Math.sin(a)*.3,pattern==="honey"?.085:.11);}}
    else if(pattern==="chevron"){g.beginPath();g.moveTo(-r*.38,-r*.22);g.lineTo(0,r*.18);g.lineTo(r*.38,-r*.22);g.stroke();}
    else if(pattern==="inner_hex"){poly(6,.43,0);}
    else if(pattern==="double_hex"){poly(6,.5,0);poly(6,.27,Math.PI/6);}
    else if(pattern==="plus"){line(-.34,0,.34,0);line(0,-.34,0,.34);}
    else if(pattern==="trident"){line(0,.4,0,-.34);line(0,-.12,-.28,-.36);line(0,-.12,.28,-.36);}
    else if(pattern==="broken"){line(-.38,.28,-.08,.02);line(.08,-.02,.38,-.28);}
    else if(pattern==="crown"){g.beginPath();g.moveTo(-r*.45,r*.2);g.lineTo(-r*.34,-r*.28);g.lineTo(0,r*.02);g.lineTo(r*.34,-r*.28);g.lineTo(r*.45,r*.2);g.closePath();g.stroke();}
    else if(pattern==="crescent"){g.beginPath();g.arc(-r*.05,0,r*.4,-1.15,1.15);g.quadraticCurveTo(-r*.12,0,-r*.05,-r*.36);g.stroke();}
    else if(pattern==="poles"){line(-.42,0,.42,0);dot(-.42,0,.12);g.beginPath();g.arc(r*.42,0,r*.12,0,U.TAU);g.stroke();}
    else if(pattern==="split"){line(0,-.52,0,.52);dot(-.25,0,.09);g.beginPath();g.arc(r*.25,0,r*.09,0,U.TAU);g.stroke();}
    else if(pattern==="nodes"){for(let k=0;k<4;k++){const a=Math.PI/4+k*Math.PI/2;line(0,0,Math.cos(a)*.46,Math.sin(a)*.46);dot(Math.cos(a)*.46,Math.sin(a)*.46,.075);}}
    else if(pattern==="judge"){line(-.38,0,.38,0);line(0,-.46,0,.46);g.beginPath();g.ellipse(0,0,r*.2,r*.11,0,0,U.TAU);g.stroke();dot(0,0,.055);}
    else if(pattern==="reactor"){g.beginPath();g.arc(0,0,r*.22,0,U.TAU);g.stroke();g.beginPath();g.arc(0,0,r*.45,0,U.TAU);g.stroke();for(let k=0;k<6;k++){const a=k*U.TAU/6;line(Math.cos(a)*.25,Math.sin(a)*.25,Math.cos(a)*.42,Math.sin(a)*.42);}}
    else if(pattern==="bloodthorn"){line(0,-.5,0,.42);for(let k=-1;k<=1;k++){const y=-.3+k*.25;line(0,y,-.28,y+.16);line(0,y,.28,y+.16);}}
    else if(pattern==="rift"){poly(4,.43,Math.PI/4);line(-.12,-.5,.12,.5);line(.12,-.5,-.12,.5);}
    else if(pattern==="shield"){poly(6,.48,0);line(-.25,-.05,0,.3);line(0,.3,.3,-.35);}
    else if(pattern==="storm"){line(-.35,-.3,.06,-.04);line(.06,-.04,-.08,.16);line(-.08,.16,.36,.34);dot(-.35,-.3,.07);dot(.36,.34,.07);}
    else if(pattern==="seer"){poly(4,.48,Math.PI/4);dot(0,0,.1);line(-.44,0,-.22,0);line(.22,0,.44,0);}
    else if(pattern==="eclipse"){g.beginPath();g.arc(0,0,r*.42,.35,U.TAU-.35);g.stroke();dot(0,0,.2);}
    g.restore();
  }

  function drawEnemyPortrait(g, def, x, y, r, options) {
    if (!def) return;
    const o = options || {}, col = o.frozen ? "#cfefff" : def.color;
    g.save(); g.fillStyle = col; g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = Math.max(1, r * 0.15);
    drawShapePath(g, x, y, r, def.shape || "circle"); g.fill(); g.stroke();
    g.save(); drawShapePath(g, x, y, Math.max(0, r - 1), def.shape || "circle"); g.clip();
    g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.38; g.fillStyle = "#ffffff";
    g.beginPath(); g.ellipse(x-r*.28,y-r*.3,r*.28,r*.14,-.55,0,U.TAU); g.fill(); g.restore();
    drawEnemyPattern(g,x,y,r,def.pattern,o.time,o.reduced,!!o.boss); g.restore();
  }

  function makeGrid() {
    const S = C.CELL;
    const cv = document.createElement("canvas"); cv.width = S; cv.height = S;
    const g = cv.getContext("2d");
    g.fillStyle = "rgba(0,0,0,0)";
    g.fillRect(0, 0, S, S);
    g.strokeStyle = COL.grid; g.lineWidth = 1;
    g.beginPath(); g.moveTo(S, 0); g.lineTo(S, S); g.lineTo(0, S); g.stroke();
    g.strokeStyle = COL.gridStrong;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(S, 0); g.stroke();
    return ctx.createPattern(cv, "repeat");
  }

  function makeStars() {
    stars.length = 0;
    for (let i = 0; i < 80; i++) {
      stars.push({ nx: Math.random(), ny: Math.random(), s: U.rand(0.6, 2.0), par: U.rand(0.25, 0.6), a: U.rand(0.25, 0.8) });
    }
  }

  function mod(v, m) { return ((v % m) + m) % m; }

  let eshotMark = false; // 敌方子弹标红(暂停界面开关):开启后每颗敌弹边缘描红,便于与己方弹幕区分

  const Renderer = {
    cam: cam,
    init: function (cv) {
      canvas = cv; ctx = cv.getContext("2d", { alpha: false });
      makeStars();
      this.resize();
    },
    resize: function () {
      if (!canvas) return;
      // 关键:用 window.innerWidth/Height(iOS Safari 视觉视口,排除 Safari UI 占位)
      // 而非 canvas.clientWidth/Height(布局视口,会包含 Safari 工具栏后面的区域,导致 buffer 比例
      // ≠ 显示比例 → 浏览器非等比拉伸 → 圆变椭圆)。
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssW = window.innerWidth || canvas.clientWidth;
      cssH = window.innerHeight || canvas.clientHeight;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      // zoom 基于 min(短边):横竖屏一致;下限 0.62 让短边屏(手机)看到更多世界
      cam.zoom = U.clamp(Math.min(cssW, cssH) / 560, 0.62, 1.4);
      gridPattern = makeGrid();
    },
    cssSize: function () { return { w: cssW, h: cssH }; },

    // 切换关卡配色(背景渐变/网格/星点)
    setPalette: function (p) {
      if (!p) return;
      COL.bg0 = p.bg0; COL.bg1 = p.bg1; COL.grid = p.grid; COL.gridStrong = p.gridStrong;
      starColor = p.star || starColor;
      gridPattern = makeGrid();
    },

    // 敌方子弹标红开关
    setEshotMark: function (on) { eshotMark = !!on; },
    getEshotMark: function () { return eshotMark; },

    // 重置相机到目标(开局)
    snapCam: function (x, y) { cam.x = x; cam.y = y; },
    followCam: function (state, dt) {
      const p = state.player;
      const k = 1 - Math.exp(-9 * dt);
      let tx = cam.x + (p.x - cam.x) * k;
      let ty = cam.y + (p.y - cam.y) * k;
      // 竞技场边界夹取(竞技场大于视口时)
      const half = (state.stage && state.stage.half) || 2000;
      const hw = cssW / 2 / cam.zoom, hh = cssH / 2 / cam.zoom;
      tx = (half > hw) ? U.clamp(tx, -half + hw, half - hw) : 0;
      ty = (half > hh) ? U.clamp(ty, -half + hh, half - hh) : 0;
      cam.x = tx; cam.y = ty;
    },

    computeView: function () {
      const hw = cssW / 2 / cam.zoom, hh = cssH / 2 / cam.zoom, m = 70;
      view.l = cam.x - hw - m; view.r = cam.x + hw + m;
      view.t = cam.y - hh - m; view.b = cam.y + hh + m;
      return view;
    },

    render: function (state) {
      if (!ctx) return;
      const sh = SV.Effects.shakeOffset();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.save();
      ctx.translate(sh.x, sh.y);

      // 背景渐变(屏幕空间)
      const grd = ctx.createLinearGradient(0, 0, 0, cssH);
      grd.addColorStop(0, COL.bg1); grd.addColorStop(1, COL.bg0);
      ctx.fillStyle = grd; ctx.fillRect(-30, -30, cssW + 60, cssH + 60);

      // 视差星点(屏幕空间,随相机缓动)
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const sx = mod(s.nx * (cssW + 40) - cam.x * s.par, cssW + 40) - 20;
        const sy = mod(s.ny * (cssH + 40) - cam.y * s.par, cssH + 40) - 20;
        ctx.globalAlpha = s.a; ctx.fillStyle = starColor;
        ctx.fillRect(sx, sy, s.s, s.s);
      }
      ctx.globalAlpha = 1;

      // 进入世界空间
      ctx.translate(cssW / 2, cssH / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);
      this.computeView();

      // 网格地面(pattern 锚定世界原点,自然滚动)
      if (gridPattern) {
        ctx.fillStyle = gridPattern;
        ctx.fillRect(view.l, view.t, view.r - view.l, view.b - view.t);
      }

      // 竞技场边界
      this._drawArenaBorder(state);

      this._drawGems(state);
      this._drawPickups(state);

      // 玩家光环(aura)可见力场
      this._drawAuraField(state);
      this._drawHazards(state);

      // ── 辉光层(加性混合,整批一次)
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      this._glowEnemies(state);
      this._glowProjectiles(state);
      this._glowBeams(state);
      this._glowPlayer(state);
      ctx.globalAlpha = 1;
      ctx.restore();

      // ── 实体核心(普通混合)
      this._drawEnemyCores(state);
      this._drawBossCues(state);
      this._drawChargeWarnings(state);
      this._drawRangedWarnings(state);
      this._drawBlinkWarnings(state);
      this._drawProjectileCores(state);
      this._drawEShots(state);
      this._drawBeams(state);
      this._drawSwings(state);
      this._drawPlayerCore(state);

      // 粒子 + 浮字
      SV.Effects.draw(ctx, view);

      ctx.restore();

      // 地图 Debuff 反馈使用屏幕空间，不随相机移动，也不进入 HUD 的交互层。
      this._drawEnvDebuff(state);

      // 屏外 Boss 箭头(屏幕空间,独立于上面的 restore)
      this._drawBossArrows(state);
    },

    _drawArenaBorder: function (state) {
      const half = (state.stage && state.stage.half) || 2000;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = COL.gridStrong;
      ctx.lineWidth = 6;
      ctx.globalAlpha = 0.8;
      ctx.strokeRect(-half, -half, half * 2, half * 2);
      ctx.globalAlpha = 0.25; ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.strokeRect(-half, -half, half * 2, half * 2);
      ctx.restore();
    },

    _drawBossArrows: function (state) {
      const arr = state.enemies;
      const margin = 44, cx = cssW / 2, cy = cssH / 2;
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        if (!e.isBoss || e.hp <= 0) continue;
        const sx = cssW / 2 + (e.x - cam.x) * cam.zoom;
        const sy = cssH / 2 + (e.y - cam.y) * cam.zoom;
        if (sx >= 0 && sx <= cssW && sy >= 0 && sy <= cssH) continue; // 屏内不画箭头
        // Boss 方向射线与安全矩形的精确交点，避免斜向目标被错误夹到角落。
        const dx = sx - cx, dy = sy - cy;
        const ang = Math.atan2(dy, dx);
        const tx = Math.abs(dx) > 0.001 ? (cssW / 2 - margin) / Math.abs(dx) : Infinity;
        const ty = Math.abs(dy) > 0.001 ? (cssH / 2 - margin) / Math.abs(dy) : Infinity;
        const hitT = Math.min(tx, ty);
        const ex = cx + dx * hitT, ey = cy + dy * hitT;
        const color = (SV.Config.BOSSES[e.bossType] && SV.Config.BOSSES[e.bossType].color) || "#ff5d73";
        const pulse = 1 + 0.12 * Math.sin((state.time || 0) * 5 + e.id);
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(ang);
        ctx.scale(pulse, pulse);
        ctx.globalAlpha = 0.9;
        ctx.drawImage(glow(color), -25, -25, 50, 50);
        ctx.fillStyle = color;
        ctx.strokeStyle = "rgba(5,8,18,.95)"; ctx.lineWidth = 4; ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(20, 0); ctx.lineTo(-11, -13); ctx.lineTo(-7, 0); ctx.lineTo(-11, 13); ctx.closePath(); ctx.stroke(); ctx.fill();
        ctx.restore();
        // 距离数字
        const dist = Math.round(U.dist(e.x, e.y, state.player.x, state.player.y));
        const label = dist + "m";
        ctx.font = "bold 12px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const lw = ctx.measureText(label).width + 10, ly = ey + 25;
        ctx.fillStyle = "rgba(3,7,16,.82)"; ctx.fillRect(ex - lw / 2, ly - 9, lw, 18);
        ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1; ctx.strokeRect(ex - lw / 2, ly - 9, lw, 18);
        ctx.fillStyle = "#fff"; ctx.fillText(label, ex, ly);
      }
    },

    // ── 宝石
    _drawGems: function (state) {
      const gems = state.gems;
      for (let i = 0; i < gems.length; i++) {
        const g = gems[i];
        if (g.x < view.l || g.x > view.r || g.y < view.t || g.y > view.b) continue;
        const col = g.value >= 5 ? COL.gold : (g.value >= 3 ? "#ffe14d" : COL.xp);
        const r = g.value >= 5 ? 6 : (g.value >= 3 ? 4.5 : 3.2);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.8; ctx.drawImage(glow(col), g.x - r * 2.4, g.y - r * 2.4, r * 4.8, r * 4.8);
        ctx.restore();
        ctx.fillStyle = col;
        ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(Math.PI / 4);
        ctx.fillRect(-r / 2, -r / 2, r, r); ctx.restore();
      }
    },

    // ── 掉落物(血包/磁铁/宝箱/清场炸弹)。宝箱用紫色菱形+脉动信标,与金色磁铁区分
    _drawPickups: function (state) {
      const list = state.pickups;
      const T = state.time;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.x < view.l || p.x > view.r || p.y < view.t || p.y > view.b) continue;
        if (p.kind === "treasure") {
          const col = "#c06bff";
          const pulse = 0.5 + 0.5 * Math.sin(T * 5 + i);
          ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.55 + 0.3 * pulse;
          ctx.drawImage(glow(col), p.x - 30, p.y - 30, 60, 60); ctx.restore();
          ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.35 + 0.35 * pulse;
          ctx.strokeStyle = col; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(p.x, p.y, 16 + pulse * 6, 0, U.TAU); ctx.stroke(); ctx.restore();
          ctx.fillStyle = col; ctx.strokeStyle = "#0a0814"; ctx.lineWidth = 2;
          drawShapePath(ctx, p.x, p.y, 11, "diamond"); ctx.fill(); ctx.stroke();
          ctx.fillStyle = "#fff"; ctx.font = "bold 13px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("★", p.x, p.y + 1);
          continue;
        }
        const col = p.kind === "health" ? "#7CFFB2" : p.kind === "magnet" ? COL.gold : p.kind === "bomb" ? "#ff5d73" : "#ffd86b";
        ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.8;
        ctx.drawImage(glow(col), p.x - 22, p.y - 22, 44, 44); ctx.restore();
        ctx.fillStyle = col; ctx.strokeStyle = "#0a0814"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, U.TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#0a0814"; ctx.font = "bold 12px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const ic = p.kind === "health" ? "+" : p.kind === "magnet" ? "✜" : p.kind === "bomb" ? "✸" : "★";
        ctx.fillText(ic, p.x, p.y + 1);
      }
    },

    _drawAuraField: function (state) {
      const p = state.player;
      for (let i = 0; i < state.weapons.length; i++) {
        const w = state.weapons[i];
        const def = SV.Config.weaponDef(w.id);
        if (def.kind !== "aura" && !def.showPlayerRadius) continue;
        const s = SV.Weapons.stats(w, state);
        ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.16;
        ctx.drawImage(glow(def.color), p.x - s.radius, p.y - s.radius, s.radius * 2, s.radius * 2);
        ctx.globalAlpha = 0.30; ctx.strokeStyle = def.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, s.radius, 0, U.TAU); ctx.stroke();
        ctx.restore();
      }
    },

    _drawHazards: function (state) {
      const arr = state.hazards;
      if (!arr || !arr.length) return;
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < arr.length; i++) {
        const h = arr[i];
        if (h.kind !== "poisonTrail" && (h.x < view.l || h.x > view.r || h.y < view.t || h.y > view.b)) continue;
        if (h.kind === "scorch") {                        // 陨石焦土:实心灼烧盘(区别于地图灼烧的辉光环),无 warm 预警
          const a = Math.max(0, h.life / h.max);
          ctx.globalAlpha = 0.20 * a; ctx.fillStyle = "#a84b18";
          ctx.beginPath(); for(let k=0;k<14;k++){const q=k/14*U.TAU,rr=h.r*(.84+.12*Math.sin(k*4.7+h.x*.01));if(k)ctx.lineTo(h.x+Math.cos(q)*rr,h.y+Math.sin(q)*rr);else ctx.moveTo(h.x+Math.cos(q)*rr,h.y+Math.sin(q)*rr);}ctx.closePath();ctx.fill();
          ctx.globalAlpha = 0.72 * a; ctx.strokeStyle = "#ffae42"; ctx.lineWidth = 2;
          const cracks=SV.Effects.isReduced()?3:6;for(let k=0;k<cracks;k++){const q=k/cracks*U.TAU+.3;ctx.beginPath();ctx.moveTo(h.x+Math.cos(q)*h.r*.15,h.y+Math.sin(q)*h.r*.15);ctx.lineTo(h.x+Math.cos(q+.12)*h.r*.55,h.y+Math.sin(q+.12)*h.r*.55);ctx.lineTo(h.x+Math.cos(q-.04)*h.r*.9,h.y+Math.sin(q-.04)*h.r*.9);ctx.stroke();}
          continue;
        }
        if (h.kind === "poisonTrail") {                   // 腐泥毒径:连续黏液带，新端清晰、旧端逐段消散
          const pts=h.points||[],tm=state.time||0;if(!pts.length)continue;
          ctx.save();ctx.globalCompositeOperation="source-over";ctx.lineCap="round";ctx.lineJoin="round";
          for(let k=0;k<pts.length;k++){
            const a=Math.max(0,pts[k].life/pts[k].max),prev=k?pts[k-1]:pts[k];
            if(Math.max(prev.x,pts[k].x)<view.l-h.r||Math.min(prev.x,pts[k].x)>view.r+h.r||Math.max(prev.y,pts[k].y)<view.t-h.r||Math.min(prev.y,pts[k].y)>view.b+h.r)continue;
            const pa=k?Math.max(0,prev.life/prev.max):a,fade=(a+pa)*.5;
            ctx.globalAlpha=.5*fade;ctx.strokeStyle="#163817";ctx.lineWidth=h.r*2;
            ctx.beginPath();ctx.moveTo(prev.x,prev.y);ctx.lineTo(pts[k].x,pts[k].y);ctx.stroke();
            ctx.globalAlpha=.58*fade;ctx.strokeStyle="#65cf4f";ctx.lineWidth=2.4;
            ctx.beginPath();ctx.moveTo(prev.x,prev.y);ctx.lineTo(pts[k].x,pts[k].y);ctx.stroke();
          }
          ctx.globalCompositeOperation="lighter";const step=SV.Effects.isReduced()?4:2;
          for(let k=0;k<pts.length;k+=step){const q=pts[k],a=Math.max(0,q.life/q.max),br=1.4+((tm*2.4+k*.61)%1)*2;ctx.globalAlpha=(.3+.22*Math.sin(tm*6+k))*a;ctx.fillStyle="#b7ff7a";ctx.beginPath();ctx.arc(q.x+Math.sin(k*2.1)*h.r*.35,q.y+Math.cos(k*1.7)*h.r*.28,br,0,U.TAU);ctx.fill();}
          ctx.restore();
          continue;
        }
        if (h.warm > 0) {
          // 地图灼烧预热：红紫旋转虚线 + 向内收缩警戒刻度。
          const pulse = 0.5 + 0.5 * Math.sin(state.time * 10 + i);
          ctx.globalAlpha = 0.45 + 0.3 * pulse; ctx.strokeStyle = "#ff4f91"; ctx.lineWidth = 3;ctx.lineDashOffset=-(state.time||0)*24;
          ctx.setLineDash([10, 7]); ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, U.TAU); ctx.stroke(); ctx.setLineDash([]);ctx.lineDashOffset=0;
          const marks=SV.Effects.isReduced()?8:16;for(let k=0;k<marks;k++){const q=k/marks*U.TAU+(state.time||0)*.25,r0=h.r*(.72+.08*pulse),r1=h.r*.94;ctx.beginPath();ctx.moveTo(h.x+Math.cos(q)*r0,h.y+Math.sin(q)*r0);ctx.lineTo(h.x+Math.cos(q)*r1,h.y+Math.sin(q)*r1);ctx.stroke();}
          continue;
        }
        const a = Math.max(0, h.life / h.max), tm = state.time || 0;
        // 地图灼烧：焦黑核心 + 熔亮裂纹 + 火舌/余烬，避免无语义的紫色连线。
        ctx.save();ctx.globalCompositeOperation="source-over";ctx.globalAlpha=.54*a;ctx.fillStyle="#3b0b08";ctx.beginPath();ctx.arc(h.x,h.y,h.r,0,U.TAU);ctx.fill();ctx.restore();
        ctx.globalAlpha=.32*a;ctx.drawImage(glow("#ff5a24"),h.x-h.r*1.55,h.y-h.r*1.55,h.r*3.1,h.r*3.1);
        ctx.globalAlpha=(.7+.18*Math.sin(tm*8+i))*a;ctx.strokeStyle="#ff5b2e";ctx.lineWidth=5;ctx.beginPath();ctx.arc(h.x,h.y,h.r,0,U.TAU);ctx.stroke();
        const cracks=SV.Effects.isReduced()?4:8;ctx.strokeStyle="#ffad42";ctx.lineWidth=1.7;
        for(let k=0;k<cracks;k++){const q=k/cracks*U.TAU+.23,wig=.09*Math.sin(tm*3+k*2.1);ctx.beginPath();ctx.moveTo(h.x+Math.cos(q)*h.r*.12,h.y+Math.sin(q)*h.r*.12);ctx.lineTo(h.x+Math.cos(q+wig)*h.r*.38,h.y+Math.sin(q+wig)*h.r*.38);ctx.lineTo(h.x+Math.cos(q-wig*.7)*h.r*.68,h.y+Math.sin(q-wig*.7)*h.r*.68);ctx.stroke();}
        const flames=SV.Effects.isReduced()?3:6;ctx.fillStyle="#ff7a2d";
        for(let k=0;k<flames;k++){const q=k/flames*U.TAU+.45,rr=h.r*(.28+.12*(k%3)),fx=h.x+Math.cos(q)*rr,fy=h.y+Math.sin(q)*rr,fh=h.r*(.22+.08*Math.sin(tm*6+k));ctx.globalAlpha=(.52+.25*Math.sin(tm*7+k*1.7))*a;ctx.beginPath();ctx.moveTo(fx-h.r*.055,fy+h.r*.08);ctx.bezierCurveTo(fx-h.r*.1,fy-fh*.18,fx+h.r*.02,fy-fh*.72,fx,fy-fh);ctx.bezierCurveTo(fx+h.r*.12,fy-fh*.5,fx+h.r*.1,fy,fx+h.r*.055,fy+h.r*.08);ctx.closePath();ctx.fill();}
        const embers=SV.Effects.isReduced()?4:9;ctx.fillStyle="#ffd36a";
        for(let k=0;k<embers;k++){const q=k*2.399+i,travel=(tm*34+k*17)%(h.r*.72),ex=h.x+Math.cos(q)*h.r*(.18+.055*(k%4)),ey=h.y+h.r*.34-travel;ctx.globalAlpha=(.35+.4*(1-travel/(h.r*.72)))*a;ctx.beginPath();ctx.arc(ex,ey,1.2+(k%2)*.7,0,U.TAU);ctx.fill();}
      }
      ctx.globalAlpha = 1; ctx.restore();
    },

    // ── 敌人辉光
    _glowEnemies: function (state) {
      const arr = state.enemies;
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        if (e.x < view.l || e.x > view.r || e.y < view.t || e.y > view.b) continue;
        ctx.globalAlpha = e.frozen > 0 ? 0.95 : (e.elite ? 0.95 : 0.8);
        ctx.drawImage(glow(e.elite ? "#ffd86b" : (e.frozen > 0 ? "#bdf0ff" : e.color)), e.x - e.r * (e.elite ? 2.8 : 2.2), e.y - e.r * (e.elite ? 2.8 : 2.2), e.r * (e.elite ? 5.6 : 4.4), e.r * (e.elite ? 5.6 : 4.4));
      }
      ctx.globalAlpha = 1;
    },
    _drawBossCues: function (state) {
      const bosses = state.enemies, tm = state.time || 0, reduced = SV.Effects.isReduced();
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineWidth = 2;
      function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
      function ring(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, U.TAU); ctx.stroke(); }
      function aura(x, y, r, color, alpha) { ctx.globalAlpha = alpha; ctx.drawImage(glow(color), x - r, y - r, r * 2, r * 2); }
      function shard(x, y, a, len) {
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.lineTo(x + Math.cos(a + 2.4) * len * 0.42, y + Math.sin(a + 2.4) * len * 0.42);
        ctx.lineTo(x + Math.cos(a - 2.4) * len * 0.42, y + Math.sin(a - 2.4) * len * 0.42);
        ctx.closePath(); ctx.fill();
      }
      function flankPoints(e, angle, distance) {
        if ([e.flankAX, e.flankAY, e.flankBX, e.flankBY].every(Number.isFinite)) {
          return [[e.flankAX, e.flankAY], [e.flankBX, e.flankBY]];
        }
        const edge = Math.max(0, ((state.stage && state.stage.half) || 2000) - 8);
        const dx = Math.cos(angle) * distance, dy = Math.sin(angle) * distance;
        return [
          [U.clamp(e.markX - dx, -edge, edge), U.clamp(e.markY - dy, -edge, edge)],
          [U.clamp(e.markX + dx, -edge, edge), U.clamp(e.markY + dy, -edge, edge)]
        ];
      }
      function fanLines(x, y, tx, ty, spread) {
        const base = U.angleTo(x, y, tx, ty), len = Math.max(90, U.dist(x, y, tx, ty) + 55);
        for (const off of [-spread / 2, spread / 2]) {
          const a = base + off;
          line(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len);
        }
      }
      for (let i = 0; i < bosses.length; i++) {
        const e = bosses[i];
        if (!e.isBoss || e.x < view.l - 300 || e.x > view.r + 300 || e.y < view.t - 300 || e.y > view.b + 300) continue;
        ctx.save();
        const mech = (SV.Config.BOSSES[e.bossType] && SV.Config.BOSSES[e.bossType].mechanics) || {};
        const tier = SV.Config.BOSSES[e.bossType].tier;
        const phase = e.cstate, pulse = 0.65 + 0.25 * Math.sin(tm * 12);
        const projectileCue = phase === "ice_warn" || phase === "ice_beam" || phase === "ice_follow" || phase === "blood_mark" || phase === "rift_open" ||
          (phase === "tele" && e.bossType === "thornwarden") || phase === "storm_warn" || phase === "storm_sweep" || phase === "ritual" ||
          phase === "sweep_warn" || phase === "architect_warn" || phase === "pull_warn" || phase === "swap" || phase === "judge_warn" ||
          phase === "eclipse_charge" || phase === "eclipse_second";
        const pincerCue = phase === "blood_mark" || phase === "rift_open";
        // 有明确状态的攻击只绘制专属预警；普通阶段继续绘制 Boss 外环。
        if (!projectileCue) {
          ctx.strokeStyle = e.color; ctx.globalAlpha = pulse;
          ctx.globalAlpha = 0.28 + 0.08 * Math.sin(tm * 3 + e.id); ctx.lineWidth = tier === 3 ? 3.5 : 2.5;
          for (let k = 0; k < tier + 3; k++) {
            const a = tm * 0.22 + k * U.TAU / (tier + 3);
            ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 8 + tier * 2, a, a + 0.42); ctx.stroke();
          }
          ctx.globalAlpha = pulse;
          if (phase && phase !== "walk") {
            aura(e.x, e.y, e.r * 2.7, e.color, 0.28 + pulse * 0.12);
            ctx.globalAlpha = pulse * 0.75; ctx.lineWidth = 2.5; ring(e.x, e.y, e.r + 10);
            ctx.fillStyle = e.color; ctx.globalAlpha = pulse * 0.72;
            const sparks = reduced ? 3 : 6;
            for (let k = 0; k < sparks; k++) {
              const a = tm * 1.8 + k * U.TAU / sparks, rr = e.r + 20 + 3 * Math.sin(tm * 8 + k);
              shard(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr, a, 6);
            }
            ctx.globalAlpha = pulse; ctx.strokeStyle = e.color; ctx.lineWidth = 2;
          }
        }
        if (phase === "ice_warn" || phase === "ice_follow") {
          const a = Number.isFinite(e.cdir) ? e.cdir : U.angleTo(e.x, e.y, e.markX, e.markY);
          for (const off of [-mech.flankAngle, mech.flankAngle]) {
            const ang = a + off, dx = Math.cos(ang), dy = Math.sin(ang);
            const len = mech.beamLength || 600, half = mech.beamWidth || 10;
            ctx.globalAlpha = phase === "ice_warn" ? 0.13 : 0.05; ctx.fillStyle = "#a6eaff"; ctx.beginPath(); ctx.moveTo(e.x, e.y);
            ctx.lineTo(e.x + dx * len - dy * half, e.y + dy * len + dx * half);
            ctx.lineTo(e.x + dx * len + dy * half, e.y + dy * len - dx * half); ctx.closePath(); ctx.fill();
            ctx.globalAlpha = pulse; ctx.lineWidth = phase === "ice_warn" ? 3 : 1.5; line(e.x, e.y, e.x + dx * len, e.y + dy * len);
            ctx.fillStyle = "#d7f8ff";
            for (let k = 1; k <= (reduced ? 2 : 4); k++) shard(e.x + dx * k * len / 5, e.y + dy * k * len / 5, ang + tm * 2 + k, 8);
          }
          if (phase === "ice_follow") { ctx.setLineDash([7, 5]); line(e.x, e.y, e.x + Math.cos(a) * (mech.beamLength || 600), e.y + Math.sin(a) * (mech.beamLength || 600)); ctx.setLineDash([]); }
        } else if (phase === "blood_mark") {
          const a = Number.isFinite(e.cdir) ? e.cdir : U.angleTo(e.x, e.y, e.markX, e.markY) + Math.PI / 2;
          aura(e.markX, e.markY, 58, e.color, 0.43);
          ctx.globalAlpha = pulse; ctx.lineWidth = 3; ring(e.markX, e.markY, 22);
          ctx.fillStyle = "#ffb8cd";
          const thorns = reduced ? 4 : 8;
          for (let k = 0; k < thorns; k++) { const q = k * U.TAU / thorns + tm * 0.5; shard(e.markX + Math.cos(q) * 30, e.markY + Math.sin(q) * 30, q, 10); }
          for (const [x, y] of flankPoints(e, a, mech.flankDist)) {
            aura(x, y, 34, e.color, 0.4); ctx.globalAlpha = pulse; ctx.lineWidth = 3;
            ring(x, y, 12); fanLines(x, y, e.markX, e.markY, mech.spread);
            ctx.fillStyle = e.color; shard(x, y, U.angleTo(x, y, e.markX, e.markY), 16);
          }
        } else if (phase === "rift_open") {
          for (const [x, y] of flankPoints(e, e.cdir, mech.portalDist)) {
            aura(x, y, 54, e.color, 0.48); ctx.globalAlpha = 0.65; ctx.fillStyle = "#271246";
            ctx.beginPath(); ctx.ellipse(x, y, 14, 29, e.cdir, 0, U.TAU); ctx.fill();
            ctx.globalAlpha = pulse; ctx.lineWidth = 3.5; ctx.strokeStyle = "#d5afff";
            ctx.beginPath(); ctx.ellipse(x, y, 18, 34, e.cdir + Math.sin(tm * 4) * 0.12, 0, U.TAU); ctx.stroke();
            ctx.strokeStyle = e.color; ctx.lineWidth = 2; fanLines(x, y, e.markX, e.markY, mech.spread);
            ctx.fillStyle = "#e8c8ff";
            const motes = reduced ? 2 : 4;
            for (let k = 0; k < motes; k++) { const q = tm * 2 + k * U.TAU / motes; shard(x + Math.cos(q) * 30, y + Math.sin(q) * 30, q, 6); }
          }
        } else if (phase === "tele" && e.bossType === "thornwarden") {
          ctx.globalAlpha = 0.3; ctx.fillStyle = e.color; ctx.beginPath(); ctx.moveTo(e.x, e.y);
          ctx.arc(e.x, e.y, 150, e.cdir - mech.spread - 0.07, e.cdir + mech.spread + 0.07); ctx.closePath(); ctx.fill();
          ctx.globalAlpha = pulse; ctx.strokeStyle = "#ffe2ed"; ctx.lineWidth = 4; ring(e.x, e.y, e.r + 12);
          ctx.strokeStyle = e.color; ctx.lineWidth = 4;
          for (let k = 0; k < 6; k++) { const q = k * U.TAU / 6; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 20, q + 0.1, q + 0.75); ctx.stroke(); }
          ctx.fillStyle = "#ffe2ed";
          for (let k = 0; k < 3; k++) { const q = e.cdir + (k - 1) * mech.spread; shard(e.x + Math.cos(q) * 92, e.y + Math.sin(q) * 92, q, 14); }
        } else if (phase === "storm_warn" || phase === "storm_sweep") {
          const dir = e.sweepDir || 1, end = e.cdir + dir * mech.sweepAngle;
          ctx.lineWidth = phase === "storm_warn" ? 5 : 3; ctx.beginPath(); ctx.arc(e.x, e.y, 150, e.cdir, end, dir < 0); ctx.stroke();
          const a = phase === "storm_warn" ? e.cdir : e.cdir + dir * (mech.sweep - e.ct) * mech.sweepAngle / mech.sweep;
          ctx.strokeStyle = "#e5dcff"; ctx.beginPath(); ctx.moveTo(e.x, e.y);
          for (let k = 1; k <= 6; k++) { const d = k * 28; ctx.lineTo(e.x + Math.cos(a) * d + Math.sin(a) * (k & 1 ? 8 : -8), e.y + Math.sin(a) * d - Math.cos(a) * (k & 1 ? 8 : -8)); }
          ctx.stroke();
          if (phase === "storm_warn") { ctx.globalAlpha = 0.25; ctx.fillStyle = e.color; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.arc(e.x, e.y, 150, e.cdir, end, dir < 0); ctx.closePath(); ctx.fill(); }
        } else if (phase === "sweep_warn" && e.bossType === "colossus") {
          const len = mech.laserLength || 600, dx = Math.cos(e.cdir), dy = Math.sin(e.cdir), half = mech.laserWidth || 16;
          ctx.globalAlpha = 0.17; ctx.fillStyle = e.color; ctx.beginPath(); ctx.moveTo(e.x, e.y);
          ctx.lineTo(e.x + dx * len - dy * half, e.y + dy * len + dx * half);
          ctx.lineTo(e.x + dx * len + dy * half, e.y + dy * len - dx * half); ctx.closePath(); ctx.fill();
          ctx.globalAlpha = pulse; ctx.strokeStyle = "#ffe2d8"; ctx.lineWidth = 4; ctx.setLineDash([12, 8]);
          line(e.x, e.y, e.x + dx * len, e.y + dy * len); ctx.setLineDash([]);
        } else if (phase === "architect_warn") {
          for (const q of [[e.flankAX, e.flankAY], [e.flankBX, e.flankBY]]) {
            aura(q[0], q[1], 52, e.color, 0.42); ctx.globalAlpha = pulse; ctx.strokeStyle = "#c9f6ff"; ctx.lineWidth = 3;
            ring(q[0], q[1], 18); ring(q[0], q[1], 34); line(q[0], q[1], e.x, e.y);
          }
        } else if (phase === "pull_warn") {
          const r = 95 + 45 * U.clamp(e.ct / Math.max(0.01, mech.pullWarn), 0, 1);
          aura(e.x, e.y, r, e.color, 0.35); ctx.globalAlpha = pulse; ctx.strokeStyle = "#d8d0ff"; ctx.lineWidth = 4;
          ring(e.x, e.y, r); ring(e.x, e.y, Math.max(e.r + 10, r - 32));
          for (let k = 0; k < 6; k++) { const a = k * U.TAU / 6; line(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, e.x + Math.cos(a) * (r - 24), e.y + Math.sin(a) * (r - 24)); }
        } else if (phase === "swap" && e.bossType === "twins") {
          const other = state.enemies.find(function (o) { return o !== e && o.bossType === "twins" && o.hp > 0; });
          if (other) { ctx.globalAlpha = pulse; ctx.strokeStyle = "#c8ffff"; ctx.lineWidth = 4; ctx.setLineDash([10, 7]); line(e.x, e.y, other.x, other.y); ctx.setLineDash([]); ring(e.x, e.y, e.r + 14); ring(other.x, other.y, other.r + 14); }
        } else if (phase === "judge_warn") {
          aura(e.echoX, e.echoY, 55, e.color, 0.32); aura(e.markX, e.markY, 68, e.color, 0.42);
          ctx.globalAlpha = pulse; ctx.strokeStyle = "#e8cfff"; ctx.lineWidth = 3; ctx.setLineDash([9, 6]);
          line(e.echoX, e.echoY, e.markX, e.markY); ctx.setLineDash([]); ring(e.echoX, e.echoY, 26); ring(e.markX, e.markY, 38);
        } else if (phase === "ritual") {
          for (const id of e.ritualMinionIds || []) {
            const o = state.enemies.find(function (other) { return other.id === id && other.hp > 0; });
            if (o) { aura(o.x, o.y, o.r * 3.2, e.color, 0.35); ctx.globalAlpha = pulse; ctx.lineWidth = 4; ring(o.x, o.y, o.r + 9); line(e.x, e.y, o.x, o.y); }
          }
        } else if (phase === "seer_warn") {
          aura(e.markX, e.markY, 72, e.color, 0.4); ctx.globalAlpha = pulse; ctx.lineWidth = 3;
          ring(e.markX, e.markY, 25); ring(e.markX, e.markY, 38); line(e.x, e.y, e.markX, e.markY);
          ctx.fillStyle = "#dbc6ff"; for (let k = 0; k < 6; k++) { const q = k * U.TAU / 6 - tm; shard(e.markX + Math.cos(q) * 42, e.markY + Math.sin(q) * 42, q, 7); }
        } else if (phase === "seer_echo") {
          aura(e.echoX, e.echoY, 65, e.color, 0.4); ctx.globalAlpha = pulse; ctx.lineWidth = 3; ring(e.echoX, e.echoY, 28);
          for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; line(e.echoX - Math.cos(a) * 48, e.echoY - Math.sin(a) * 48, e.echoX + Math.cos(a) * 48, e.echoY + Math.sin(a) * 48); }
        } else if (phase === "eclipse_charge" || phase === "eclipse_second") {
          ctx.globalAlpha = 0.38; ctx.fillStyle = "#280d36"; ctx.beginPath(); ctx.arc(e.x, e.y, 85, 0, U.TAU); ctx.fill();
          ctx.globalAlpha = pulse; ctx.strokeStyle = "#ffc3f2"; ctx.lineWidth = 8;
          ctx.beginPath(); ctx.arc(e.x, e.y, 115, e.gapAngle + mech.gapHalf, e.gapAngle + U.TAU - mech.gapHalf); ctx.stroke();
          ctx.strokeStyle = e.color; ctx.lineWidth = 2.5; ring(e.x, e.y, 86);
          for (const off of [-mech.gapHalf, mech.gapHalf]) line(e.x, e.y, e.x + Math.cos(e.gapAngle + off) * 115, e.y + Math.sin(e.gapAngle + off) * 115);
          ctx.fillStyle = "#ffe1f7";
          const ticks = reduced ? 8 : 16;
          for (let k = 0; k < ticks; k++) {
            const q = k * U.TAU / ticks + tm * 0.4;
            if (Math.abs(Math.atan2(Math.sin(q - e.gapAngle), Math.cos(q - e.gapAngle))) < mech.gapHalf) continue;
            shard(e.x + Math.cos(q) * 108, e.y + Math.sin(q) * 108, q, 7);
          }
        }
        ctx.restore();
      }
      ctx.restore();
    },
    _drawEnemyCores: function (state) {
      const arr = state.enemies;
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        if (e.x < view.l || e.x > view.r || e.y < view.t || e.y > view.b) continue;
        const stealthed = e.stealth && !e.revealed;
        ctx.save();
        if (stealthed) ctx.globalAlpha = 0.25;
        if (e.sheep > 0) {
          // 绵羊:蓬松白羊毛 + 敌色头(一眼可辨"被变形")
          const rr = e.r * 1.1;
          ctx.fillStyle = "#f5f3ec"; ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(e.x, e.y, rr, 0, U.TAU); ctx.fill(); ctx.stroke();
          ctx.fillStyle = "#e7e3d6";
          ctx.beginPath(); ctx.arc(e.x - rr * 0.4, e.y - rr * 0.25, rr * 0.32, 0, U.TAU); ctx.fill();
          ctx.beginPath(); ctx.arc(e.x + rr * 0.25, e.y + rr * 0.25, rr * 0.3, 0, U.TAU); ctx.fill();
          ctx.fillStyle = e.color;
          ctx.beginPath(); ctx.arc(e.x + rr * 0.5, e.y - rr * 0.5, rr * 0.32, 0, U.TAU); ctx.fill();
        } else {
          const def = e.isBoss ? SV.Config.BOSSES[e.bossType] : SV.Config.ENEMIES[e.type];
          drawEnemyPortrait(ctx, def || e, e.x, e.y, e.r, { boss:e.isBoss, frozen:e.frozen>0, time:state.time, reduced:SV.Effects.isReduced() });
        }
        ctx.restore();
        // 光环(盾卫/祭司/狂热者):淡填充 + 虚线环
        if (e.auraR) {
          ctx.save(); ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = 0.06; ctx.fillStyle = e.color;
          ctx.beginPath(); ctx.arc(e.x, e.y, e.auraR, 0, U.TAU); ctx.fill();
          ctx.globalAlpha = 0.32; ctx.strokeStyle = e.color; ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.arc(e.x, e.y, e.auraR, 0, U.TAU); ctx.stroke(); ctx.setLineDash([]);
          ctx.restore();
        }
        // 内核高光已由 drawEnemyPortrait 裁切在几何轮廓内；羊形态不叠加敌人高光。
        // ghost 高价值提示:金色正弦闪烁(一眼看出是奖励目标)
        if (e.shimmer) {
          const sh = 0.5 + 0.5 * Math.sin(state.time * 8 + e.id);
          ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = sh * 0.7;
          ctx.fillStyle = SV.Config.COLORS.gold;
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 1.3, 0, U.TAU); ctx.fill();
          ctx.restore();
        }
        // 贴合敌人形状的覆盖层基准(绵羊态身体是圆,其余用自身 shape);光环盾卫的护盾光环(auraR)另画、保持圆形
        const eshape = e.sheep > 0 ? "circle" : e.shape;
        // 受击白闪 / 冲刺预警:贴合形状(原圆形覆盖方形敌人会溢出)
        if (e.flash > 0) { ctx.globalAlpha = Math.min(1, e.flash * 5); ctx.fillStyle = "#ffffff"; drawShapePath(ctx, e.x, e.y, e.r, eshape); ctx.fill(); ctx.globalAlpha = 1; }
        // 剧毒泛绿(叠层越深越绿;贴合形状)
        if (e.poison > 0) { ctx.globalAlpha = 0.30 + 0.12 * (e.poisonStacks || 0); ctx.fillStyle = "#9bff5a"; drawShapePath(ctx, e.x, e.y, e.r, eshape); ctx.fill(); ctx.globalAlpha = 1; }
        // 状态标记保持小而稳定；低特效也保留这些玩法信息。
        const pulse = 0.88 + 0.12 * Math.sin((state.time || 0) * 4 + e.id);
        if (e.poison > 0) { ctx.fillStyle="#9bff5a";ctx.globalAlpha=.8;const n=Math.min(3,e.poisonStacks||1);for(let k=0;k<n;k++){ctx.beginPath();ctx.arc(e.x-e.r*.55+k*4,e.y+e.r*.72-(k&1)*3,1.8+k*.35,0,U.TAU);ctx.fill();}ctx.globalAlpha=1; }
        if (e.slow > 0 && !(e.frozen > 0)) drawSlowFracture(ctx,e,eshape,pulse,SV.Effects.isReduced());
        if (e.hex > 0) { const left=U.clamp(e.hex/Math.max(.01,e.hexMax||e.hex),0,1),rr=e.r+3+3*left;ctx.save();ctx.strokeStyle=e.hexChild?"#ddbaff":"#c78cff";ctx.globalAlpha=(.66+.18*(1-left))*pulse;ctx.lineWidth=e.hexChild?1.5:2;ctx.setLineDash(e.hexChild?[3,4]:[]);ctx.beginPath();ctx.arc(e.x,e.y,rr,0,U.TAU);ctx.stroke();if(!e.hexChild){ctx.beginPath();ctx.arc(e.x,e.y,rr-4,0,U.TAU);ctx.stroke();for(let k=0;k<4;k++){const a=k*Math.PI/2;ctx.beginPath();ctx.moveTo(e.x+Math.cos(a)*(rr+2),e.y+Math.sin(a)*(rr+2));ctx.lineTo(e.x+Math.cos(a)*(rr-3),e.y+Math.sin(a)*(rr-3));ctx.stroke();}}else{ctx.fillStyle="#ead8ff";ctx.setLineDash([]);for(let k=0;k<3;k++){const a=k*U.TAU/3;ctx.beginPath();ctx.arc(e.x+Math.cos(a)*rr,e.y+Math.sin(a)*rr,1.8,0,U.TAU);ctx.fill();}}ctx.restore(); }
        if (e.armorBreak > 0) { const x=e.x+e.r*.72,y=e.y-e.r*.7,rr=Math.max(5,e.r*.32);ctx.save();ctx.strokeStyle="#ffad55";ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(x-rr,y-rr*.7);ctx.lineTo(x,y-rr);ctx.lineTo(x+rr,y-rr*.7);ctx.lineTo(x+rr*.7,y+rr*.5);ctx.lineTo(x,y+rr);ctx.lineTo(x-rr*.7,y+rr*.5);ctx.closePath();ctx.stroke();ctx.beginPath();ctx.moveTo(x-rr*.15,y-rr);ctx.lineTo(x+rr*.15,y-rr*.15);ctx.lineTo(x-rr*.25,y+rr*.2);ctx.lineTo(x+rr*.15,y+rr);ctx.stroke();ctx.restore(); }
        if ((e._corrode||0)>0) { ctx.save();ctx.strokeStyle="#668f3a";ctx.lineWidth=2;for(let k=0;k<Math.min(5,e._corrode);k++){const a=-2.7+k*.27,rr=e.r+7;ctx.beginPath();ctx.moveTo(e.x+Math.cos(a)*rr,e.y+Math.sin(a)*rr);ctx.lineTo(e.x+Math.cos(a)*(rr+5),e.y+Math.sin(a)*(rr+5));ctx.stroke();}ctx.restore(); }
        if ((e._judgeHits||0)>0) { ctx.save();ctx.fillStyle="#c99aff";for(let k=0;k<Math.min(5,e._judgeHits);k++)ctx.fillRect(e.x-(Math.min(5,e._judgeHits)*4-1)/2+k*4,e.y-e.r-14,3,5);ctx.restore(); }
        // 时之诅咒炸弹羊:脉冲时钟环,剩余越少闪烁越快。
        if (e.sheepBomb && !e.sheepBombDone) {
          const left = U.clamp(e.sheep / Math.max(0.01, e.sheepBombMax || e.sheep), 0, 1);
          const freq = 6 + (1 - left) * 22;
          const pulse = 0.45 + 0.45 * Math.sin(state.time * freq + e.id);
          const rr = e.r + 9 + pulse * 3;
          ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.55 + pulse * 0.35;
          ctx.strokeStyle = "#d6b3ff"; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(e.x, e.y, rr, 0, U.TAU); ctx.stroke();
          const hand = -Math.PI / 2 + (1 - left) * U.TAU;
          ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(hand) * rr * 0.68, e.y + Math.sin(hand) * rr * 0.68); ctx.stroke();
          ctx.restore();
        }
        // 精英:金色轮廓(贴合形状)
        if (e.elite) {
          ctx.strokeStyle = "rgba(255,216,107,0.9)"; ctx.lineWidth = 2.5;
          drawShapePath(ctx, e.x, e.y, e.r + 6, eshape); ctx.stroke();
        }
        // Boss:脉冲红轮廓(贴合形状;一眼可见,alpha 保底 0.65)
        if (e.isBoss) {
          const pulse = 0.8 + 0.15 * Math.sin(state.time * 6 + e.id);
          ctx.strokeStyle = "rgba(255,60,80," + pulse.toFixed(3) + ")"; ctx.lineWidth = 3;
          drawShapePath(ctx, e.x, e.y, e.r + 10, eshape); ctx.stroke();
          ctx.strokeStyle = "rgba(255,60,80," + (0.35 + 0.15 * Math.sin(state.time * 6 + e.id + 1)).toFixed(3) + ")"; ctx.lineWidth = 2;
          drawShapePath(ctx, e.x, e.y, e.r + 16, eshape); ctx.stroke();
        }
        // 血条(受伤过的非Boss;潜伏者隐身时不画)
        if (!e.isBoss && !stealthed && e.hp < e.maxHp) {
          const w = e.r * 1.8;
          ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(e.x - w / 2, e.y - e.r - 8, w, 3);
          ctx.fillStyle = "#ff6b7d"; ctx.fillRect(e.x - w / 2, e.y - e.r - 8, w * U.clamp(e.hp / e.maxHp, 0, 1), 3);
        }
      }
    },
    // 冲锋兽蓄力：锁定方向的高对比跑道、箭头和收缩倒计时环；低特效仍完整显示。
    _drawChargeWarnings: function (state) {
      const arr = state.enemies;
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        if (e.type !== "charger" || e.cstate !== "tele" || !(e.teleT > 0)) continue;
        if (e.x < view.l || e.x > view.r || e.y < view.t || e.y > view.b) continue;
        const left = U.clamp(e.teleT / 0.7, 0, 1);
        const pulse = 0.5 + 0.5 * Math.sin((state.time || 0) * 30 + e.id);
        const dx = Math.cos(e.cdir), dy = Math.sin(e.cdir), nx = -dy, ny = dx;
        const len = SV.Config.ENEMIES.charger.chargeSpeed * 0.6;
        const ex = e.x + dx * len, ey = e.y + dy * len;
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        // 双边冲锋跑道比单线更容易看清实际危险宽度。
        ctx.strokeStyle = "#ffb24d"; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.58 + pulse * 0.3;
        ctx.setLineDash([12, 7]); ctx.lineDashOffset = -(state.time || 0) * 70;
        for (let side = -1; side <= 1; side += 2) {
          const off = side * (e.r + 5);
          ctx.beginPath(); ctx.moveTo(e.x + nx * off, e.y + ny * off); ctx.lineTo(ex + nx * off, ey + ny * off); ctx.stroke();
        }
        ctx.setLineDash([]); ctx.lineDashOffset = 0;
        // 跑道中央连续箭头，明确指出锁定后的冲锋方向。
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.globalAlpha = 0.9;
        for (let k = 1; k <= 3; k++) {
          const px = e.x + dx * len * k / 4, py = e.y + dy * len * k / 4, arm = 9;
          ctx.beginPath(); ctx.moveTo(px - dx * arm + nx * arm * 0.7, py - dy * arm + ny * arm * 0.7); ctx.lineTo(px, py); ctx.lineTo(px - dx * arm - nx * arm * 0.7, py - dy * arm - ny * arm * 0.7); ctx.stroke();
        }
        const rr = e.r + 8 + left * 16;
        ctx.strokeStyle = "#ffcf70"; ctx.lineWidth = 3; ctx.globalAlpha = 0.75 + pulse * 0.2;
        ctx.beginPath(); ctx.arc(e.x, e.y, rr, 0, U.TAU); ctx.stroke();
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5;
        drawShapePath(ctx, e.x, e.y, e.r + 4 + pulse * 3, "triangle"); ctx.stroke();
        ctx.restore();
      }
    },
    // 普通远程敌人只显示蓄力倒计时圈；离体炮台额外显示射击来源和方向。
    _drawRangedWarnings: function (state) {
      const arr = state.enemies, tm = state.time || 0;
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i], warning = e.cstate === "shot_warn" || e.cstate === "sniper_warn";
        if (!warning || e.x < view.l || e.x > view.r || e.y < view.t || e.y > view.b) continue;
        const sniper = e.cstate === "sniper_warn", def = SV.Config.ENEMIES[sniper ? "sniper" : "shooter"];
        const warn = e.architectTurret ? SV.Config.BOSSES.architect.mechanics.turretWarn : def.shotWarn;
        const left = U.clamp((e.ct || 0) / warn, 0, 1), len = 440;
        const dx = Math.cos(e.cdir), dy = Math.sin(e.cdir), pulse = 0.65 + 0.25 * Math.sin(tm * 24 + e.id);
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = sniper ? "#ff91ef" : (e.architectTurret ? "#8fe8ff" : "#70dfff");
        if (e.architectTurret) {
          ctx.globalAlpha = 0.55 + pulse * 0.3; ctx.lineWidth = 2; ctx.setLineDash([7, 6]);
          ctx.lineDashOffset = -tm * 55; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + dx * len, e.y + dy * len); ctx.stroke();
        }
        ctx.setLineDash([]); ctx.globalAlpha = 0.8; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 7 + left * 10, 0, U.TAU); ctx.stroke();
        ctx.restore();
      }
    },
    // 闪烁者瞬移预警属于玩法信息：低特效也保留完整轮廓；落点在屏内时不受本体剔除影响。
    _drawBlinkWarnings: function (state) {
      const arr = state.enemies;
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        if (e.type !== "blinker" || !(e.blinkWarn > 0) || e.blinkX == null) continue;
        const originIn = e.x >= view.l && e.x <= view.r && e.y >= view.t && e.y <= view.b;
        const targetIn = e.blinkX >= view.l && e.blinkX <= view.r && e.blinkY >= view.t && e.blinkY <= view.b;
        if (!originIn && !targetIn) continue;
        const left = U.clamp(e.blinkWarn / C.BLINK_WARN, 0, 1);
        const pulse = 0.5 + 0.5 * Math.sin((state.time || 0) * 28 + e.id);
        const rr = 10 + 15 * left;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.lineDashOffset = -(state.time || 0) * 55;
        ctx.setLineDash([7, 6]); ctx.strokeStyle = "#c084fc"; ctx.lineWidth = 2;
        ctx.globalAlpha = 0.55 + pulse * 0.35;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.blinkX, e.blinkY); ctx.stroke();
        ctx.setLineDash([]); ctx.lineDashOffset = 0;
        // 原地双层紫白菱形脉冲。
        ctx.strokeStyle = "#c084fc"; ctx.lineWidth = 3;
        drawShapePath(ctx, e.x, e.y, e.r + 6 + pulse * 4, "diamond"); ctx.stroke();
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5;
        drawShapePath(ctx, e.x, e.y, e.r + 1 + pulse * 2, "diamond"); ctx.stroke();
        // 收缩的落点菱形与警戒环，倒计时结束时精确汇聚到固定落点。
        ctx.strokeStyle = "#d8b4fe"; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(e.blinkX, e.blinkY, rr, 0, U.TAU); ctx.stroke();
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
        drawShapePath(ctx, e.blinkX, e.blinkY, 8 + 10 * left, "diamond"); ctx.stroke();
        ctx.restore();
      }
    },

    _glowProjectiles: function (state) {
      const list = SV.Weapons.proj.list;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.shockwave) continue; // 冲击波用描边环绘制,不走辉光(p.r 会变得很大)
        if (p.grid) {
          const dx = Math.cos(p.gridDir), dy = Math.sin(p.gridDir), h = p.gridLen / 2;
          const x0=p.x-dx*h,x1=p.x+dx*h,y0=p.y-dy*h,y1=p.y+dy*h,pad=p.gridWidth*1.5;
          if(Math.max(x0,x1)<view.l-pad||Math.min(x0,x1)>view.r+pad||Math.max(y0,y1)<view.t-pad||Math.min(y0,y1)>view.b+pad)continue;
          ctx.globalAlpha = 0.34 + 0.22 * (p.life / p.maxLife); ctx.strokeStyle = p.color; ctx.lineWidth = p.gridWidth * 1.7;
          ctx.beginPath(); ctx.moveTo(p.x - dx * h, p.y - dy * h); ctx.lineTo(p.x + dx * h, p.y + dy * h); ctx.stroke();
          continue;
        }
        if (p.x < view.l || p.x > view.r || p.y < view.t || p.y > view.b) continue;
        if (p.plasmaCore) {
          const rr=p.coreR||40;ctx.globalAlpha=0.28+0.12*Math.sin((state.time||0)*12);ctx.drawImage(glow(p.color),p.x-rr,p.y-rr,rr*2,rr*2);continue;
        }
        ctx.globalAlpha = 0.9; ctx.drawImage(glow(p.color), p.x - p.r * 3, p.y - p.r * 3, p.r * 6, p.r * 6);
      }
      ctx.globalAlpha = 1;
    },
    _drawProjectileCores: function (state) {
      const list = SV.Weapons.proj.list;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.grid) {
          const dx=Math.cos(p.gridDir),dy=Math.sin(p.gridDir),h=p.gridLen/2,x0=p.x-dx*h,x1=p.x+dx*h,y0=p.y-dy*h,y1=p.y+dy*h,pad=p.gridWidth;
          if(Math.max(x0,x1)<view.l-pad||Math.min(x0,x1)>view.r+pad||Math.max(y0,y1)<view.t-pad||Math.min(y0,y1)>view.b+pad)continue;
        } else if (p.x < view.l || p.x > view.r || p.y < view.t || p.y > view.b) continue;
        const vis = SV.Config.weaponVisual(p.weaponId || "");
        p.visualStyle = p.visualStyle || vis.family;
        const fam = p.visualStyle;
        if (p.weaponId === "spear_timestop") {
          const a = Math.atan2(p.vy, p.vx) || state.player.facing, fade = Math.min(1, p.life / 0.12);
          ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(a); ctx.globalAlpha=.22*fade; ctx.fillStyle=p.color; ctx.fillRect(-p.r*2,-p.r,p.r*4,p.r*2);
          ctx.globalAlpha=.75*fade;ctx.strokeStyle="#fff";ctx.lineWidth=1;ctx.setLineDash([8,7]);ctx.strokeRect(-p.r*2,-p.r,p.r*4,p.r*2);ctx.setLineDash([]);
          for(let k=-2;k<=2;k++){ctx.beginPath();ctx.arc(k*p.r*.65,0,3,0,U.TAU);ctx.stroke();}ctx.restore();
        } else if (p.grid) {
          const dx = Math.cos(p.gridDir), dy = Math.sin(p.gridDir), h = p.gridLen / 2;
          const pulse = 0.7 + 0.3 * Math.sin((state.time || 0) * 24 + p.x * 0.03 + p.y * 0.02);
          ctx.save(); ctx.globalAlpha = pulse * Math.min(1, p.life / 0.12); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = p.gridWidth;
          ctx.beginPath(); ctx.moveTo(p.x - dx * h, p.y - dy * h); ctx.lineTo(p.x + dx * h, p.y + dy * h); ctx.stroke(); ctx.restore();
        } else if (p.shockwave) {
          ctx.save();
          ctx.globalAlpha = 0.5; ctx.strokeStyle = p.color; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, U.TAU); ctx.stroke();
          ctx.globalAlpha = 0.22; ctx.lineWidth = 9;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, U.TAU); ctx.stroke();
          ctx.restore();
        } else if (p.moonArc) {
          const a=Math.atan2(p.vy,p.vx);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(a);ctx.strokeStyle=p.color;ctx.lineCap="round";ctx.globalAlpha=.9;ctx.lineWidth=Math.max(5,p.r*.18);ctx.beginPath();ctx.arc(0,0,p.r*.68,-1.05,1.05);ctx.stroke();ctx.globalAlpha=.55;ctx.lineWidth=Math.max(2,p.r*.08);ctx.beginPath();ctx.arc(-p.r*.16,0,p.r*.7,-.9,.9);ctx.stroke();ctx.restore();
        } else if (p.shape === "star") {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
          ctx.fillStyle = p.color; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
          ctx.beginPath();
          for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; ctx.lineTo(Math.cos(a) * p.r * 1.6, Math.sin(a) * p.r * 1.6); ctx.lineTo(Math.cos(a + Math.PI / 4) * p.r * 0.5, Math.sin(a + Math.PI / 4) * p.r * 0.5); }
          ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
        } else if (fam === "rocket" || fam === "scatter" || fam === "turret" || fam === "needle" || fam === "spear") {
          const a=Math.atan2(p.vy,p.vx);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(a);ctx.fillStyle=p.color;ctx.strokeStyle="#fff";ctx.lineWidth=1;
          const long=fam==="needle"||fam==="spear"?2.5:1.6;ctx.beginPath();ctx.moveTo(p.r*long,0);ctx.lineTo(-p.r,.72*p.r);ctx.lineTo(-.65*p.r,0);ctx.lineTo(-p.r,-.72*p.r);ctx.closePath();ctx.fill();ctx.stroke();
          if(fam==="rocket"){ctx.fillStyle="#ffcf72";ctx.beginPath();ctx.moveTo(-p.r,0);ctx.lineTo(-p.r*2,.55*p.r);ctx.lineTo(-p.r*1.7,-.55*p.r);ctx.closePath();ctx.fill();}ctx.restore();
        } else if (fam === "fuseball" || fam === "ramcloud") {
          ctx.save();ctx.translate(p.x,p.y);ctx.fillStyle=p.color;ctx.strokeStyle="#fff";ctx.lineWidth=1.4;ctx.beginPath();
          if(fam==="ramcloud"){for(let k=0;k<8;k++){const a=k*U.TAU/8,rr=p.r*(k&1?1.05:1.3);ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr);}ctx.closePath();ctx.fill();ctx.stroke();ctx.beginPath();ctx.arc(-p.r*.75,-p.r*.7,p.r*.45,.2,Math.PI*1.5);ctx.stroke();ctx.beginPath();ctx.arc(p.r*.75,-p.r*.7,p.r*.45,Math.PI*1.5,Math.PI*.8);ctx.stroke();}
          else{ctx.arc(0,0,p.r,0,U.TAU);ctx.fill();ctx.stroke();ctx.setLineDash([2,2]);ctx.beginPath();ctx.moveTo(p.r*.5,-p.r*.7);ctx.quadraticCurveTo(p.r,-p.r*1.5,p.r*1.4,-p.r*1.1);ctx.stroke();ctx.setLineDash([]);}ctx.restore();
        } else if (fam === "clock") {
          ctx.save();ctx.translate(p.x,p.y);ctx.strokeStyle=p.color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,p.r,0,U.TAU);ctx.stroke();ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-p.r*.65);ctx.moveTo(0,0);ctx.lineTo(p.r*.5,p.r*.25);ctx.stroke();ctx.restore();
        } else if (fam === "spiral") {
          ctx.save();ctx.translate(p.x,p.y);ctx.rotate((state.time||0)*5);ctx.strokeStyle=p.color;ctx.lineWidth=2;for(let k=0;k<3;k++){ctx.beginPath();ctx.arc(0,0,p.r*(.45+k*.3),k*1.7,k*1.7+2.5);ctx.stroke();}ctx.restore();
        } else {
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.7, 0, U.TAU); ctx.fill();
          ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, U.TAU); ctx.fill();
        }
      }
    },

    _drawEnvDebuff: function(state) {
      const env=state.stage&&state.stage.envField;if(!env)return;
      let left=0;if(env.type==="freeze")left=state.player.slow||0;else if(env.type==="gravity")left=state._voidPull||0;if(left<=0)return;
      const max=state._envDebuffMax||left, edge=U.clamp(left/Math.min(.45,max),0,1), pulse=1+.12*Math.sin((state.time||0)*11);
      ctx.save();ctx.globalAlpha=edge*pulse;ctx.lineWidth=Math.max(10,Math.min(cssW,cssH)*.025);
      if(env.type==="freeze"){
        const band=Math.max(72,Math.min(cssW,cssH)*.12),alpha=edge*pulse;
        // 四条由高饱和外缘向内透明衰减的冰霜带；角落叠加形成更厚的冻结感。
        let g=ctx.createLinearGradient(0,0,0,band);g.addColorStop(0,"rgba(35,180,255,.72)");g.addColorStop(.35,"rgba(100,215,255,.34)");g.addColorStop(1,"rgba(120,225,255,0)");ctx.globalAlpha=alpha;ctx.fillStyle=g;ctx.fillRect(0,0,cssW,band);
        g=ctx.createLinearGradient(0,cssH,0,cssH-band);g.addColorStop(0,"rgba(35,180,255,.72)");g.addColorStop(.35,"rgba(100,215,255,.34)");g.addColorStop(1,"rgba(120,225,255,0)");ctx.fillStyle=g;ctx.fillRect(0,cssH-band,cssW,band);
        g=ctx.createLinearGradient(0,0,band,0);g.addColorStop(0,"rgba(35,180,255,.72)");g.addColorStop(.35,"rgba(100,215,255,.34)");g.addColorStop(1,"rgba(120,225,255,0)");ctx.fillStyle=g;ctx.fillRect(0,0,band,cssH);
        g=ctx.createLinearGradient(cssW,0,cssW-band,0);g.addColorStop(0,"rgba(35,180,255,.72)");g.addColorStop(.35,"rgba(100,215,255,.34)");g.addColorStop(1,"rgba(120,225,255,0)");ctx.fillStyle=g;ctx.fillRect(cssW-band,0,band,cssH);
        ctx.globalAlpha=alpha;ctx.strokeStyle="rgba(180,238,255,.48)";ctx.lineWidth=Math.max(3,Math.min(cssW,cssH)*.008);ctx.strokeRect(3,3,cssW-6,cssH-6);
        const corners=[[12,12,1,1],[cssW-12,12,-1,1],[12,cssH-12,1,-1],[cssW-12,cssH-12,-1,-1]],branches=SV.Effects.isReduced()?2:4;ctx.strokeStyle="rgba(225,250,255,.86)";ctx.fillStyle="rgba(145,225,255,.2)";ctx.lineWidth=1.6;
        for(let c=0;c<corners.length;c++){const q=corners[c];ctx.save();ctx.translate(q[0],q[1]);ctx.scale(q[2],q[3]);for(let k=0;k<branches;k++){const ang=.18+k*.66/(branches-1),len=52+(k%2)*18,ux=Math.cos(ang),uy=Math.sin(ang),nx=-uy,ny=ux;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(ux*len,uy*len);ctx.stroke();for(let j=1;j<=2;j++){const d=len*(.38+j*.2),arm=10+j*3;ctx.beginPath();ctx.moveTo(ux*d,uy*d);ctx.lineTo(ux*(d-arm*.55)+nx*arm,uy*(d-arm*.55)+ny*arm);ctx.moveTo(ux*d,uy*d);ctx.lineTo(ux*(d-arm*.55)-nx*arm,uy*(d-arm*.55)-ny*arm);ctx.stroke();}ctx.beginPath();ctx.moveTo(ux*len,uy*len);ctx.lineTo(ux*(len-11)+nx*5,uy*(len-11)+ny*5);ctx.lineTo(ux*(len-16),uy*(len-16));ctx.lineTo(ux*(len-11)-nx*5,uy*(len-11)-ny*5);ctx.closePath();ctx.fill();}ctx.restore();}
        // 折射光只贴边铺开，避免左上角出现缺乏语义的整块蓝色斜面。
        ctx.globalAlpha*=.16;ctx.fillStyle="#9be7ff";
        const rim=Math.max(8,Math.min(cssW,cssH)*.02);
        ctx.fillRect(0,0,cssW,rim);ctx.fillRect(0,cssH-rim,cssW,rim);
        ctx.fillRect(0,rim,rim,cssH-rim*2);ctx.fillRect(cssW-rim,rim,rim,cssH-rim*2);
      }else{
        const a=state._voidPullDir||0,dx=Math.cos(a),dy=Math.sin(a),px=-dy,py=dx,t=state.time||0,span=Math.hypot(cssW,cssH),cross=Math.min(cssW,cssH)*.58;
        // 平行粒子流沿实际牵引方向掠过屏幕，不再绘制具象引力核。
        const tracks=SV.Effects.isReduced()?8:18;ctx.strokeStyle="rgba(205,165,255,.82)";ctx.fillStyle="#ead8ff";ctx.lineWidth=1.5;
        for(let k=0;k<tracks;k++){const phase=((t*190+k*137)%span)-span*.5,off=Math.sin(k*91.73)*cross,cx=cssW/2+dx*phase+px*off,cy=cssH/2+dy*phase+py*off,len=18+10*(k%3);ctx.globalAlpha=edge*(.35+.5*(k%3)/2);ctx.beginPath();ctx.moveTo(cx-dx*len,cy-dy*len);ctx.lineTo(cx,cy);ctx.stroke();ctx.save();ctx.translate(cx,cy);ctx.rotate(a);ctx.beginPath();ctx.moveTo(5,0);ctx.lineTo(-3,-2.2);ctx.lineTo(-1,0);ctx.lineTo(-3,2.2);ctx.closePath();ctx.fill();ctx.restore();}
      }ctx.restore();
    },

    // ── 敌方投射物(boss/炮台)。Boss 弹幕专属风格:ring 空心魔环 / bolt 高速光矛 / rune 符文菱形
    // (风格由 config BOSSES.shotStyle 决定,addEShot 打 boss 标记;均复用缓存 glow,不进实时 shadowBlur)
    _drawEShots: function (state) {
      const list = state.eshots;
      if (!list.length) return;
      const now = state.time || 0;
      // 辉光层(lighter):普通弹用原样方形辉光;Boss 弹加大 + 常驻微脉冲(相位用坐标伪随机,零字段开销)
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.x < view.l || s.x > view.r || s.y < view.t || s.y > view.b) continue;
        if (s.boss) {
          const pulse = 1 + 0.14 * Math.sin(now * 7 + s.x * 0.13 + s.y * 0.17);
          const R = (s.r + 1.5) * pulse;
          ctx.globalAlpha = 0.9;
          if (s.style === "bolt") {
            // 高速光矛:辉光沿速度方向拉长 ×2.2
            ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(Math.atan2(s.vy, s.vx));
            ctx.drawImage(glow(s.color), -R * 2.2, -R, R * 4.4, R * 2);
            ctx.restore();
          } else {
            const g = R * 3.2;
            ctx.drawImage(glow(s.color), s.x - g, s.y - g, g * 2, g * 2);
          }
        } else {
          ctx.globalAlpha = 0.85; ctx.drawImage(glow(s.color), s.x - s.r * 3, s.y - s.r * 3, s.r * 6, s.r * 6);
        }
      }
      ctx.globalAlpha = 1; ctx.restore();
      // 弹体层
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.x < view.l || s.x > view.r || s.y < view.t || s.y > view.b) continue;
        const R = s.r + (s.boss ? 1.5 : 0);
        if (s.boss) {
          const len = Math.hypot(s.vx, s.vy) || 1, dx = s.vx / len, dy = s.vy / len;
          ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = s.color;
          ctx.globalAlpha = 0.52; ctx.lineWidth = Math.max(2, R * 0.7); ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(s.x - dx * R, s.y - dy * R); ctx.lineTo(s.x - dx * R * 3.7, s.y - dy * R * 3.7); ctx.stroke();
          ctx.globalAlpha = 0.72; ctx.lineWidth = 1.3; ctx.strokeStyle = "#fff";
          ctx.beginPath(); ctx.moveTo(s.x - dx * R * 0.4, s.y - dy * R * 0.4); ctx.lineTo(s.x - dx * R * 2.1, s.y - dy * R * 2.1); ctx.stroke();
          ctx.restore();
        }
        if (s.style === "ring") {
          // 空心魔环:彩色粗描边 + 细白内环(无实芯),弹幕游戏经典轮廓
          ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(2.5, R * 0.38);
          ctx.beginPath(); ctx.arc(s.x, s.y, R * 0.82, 0, U.TAU); ctx.stroke();
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(s.x, s.y, R * 0.4, 0, U.TAU); ctx.stroke();
        } else if (s.style === "bolt" || s.style === "rune") {
          // 菱形弹芯:bolt 沿速度方向(速度感),rune 随时间缓转(相位按坐标错开,非同步旋转)
          const a = s.style === "bolt" ? Math.atan2(s.vy, s.vx) : now * 2.2 + s.x * 0.05 + s.y * 0.07;
          ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(a);
          ctx.fillStyle = s.color;
          ctx.beginPath(); ctx.moveTo(R * 1.5, 0); ctx.lineTo(0, R * 0.75); ctx.lineTo(-R * 1.5, 0); ctx.lineTo(0, -R * 0.75); ctx.closePath(); ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.beginPath(); ctx.moveTo(R * 0.7, 0); ctx.lineTo(0, R * 0.34); ctx.lineTo(-R * 0.7, 0); ctx.lineTo(0, -R * 0.34); ctx.closePath(); ctx.fill();
          ctx.restore();
        } else {
          // 普通敌弹:白芯 + 彩色圆(原样)
          ctx.fillStyle = "#fff";
          ctx.beginPath(); ctx.arc(s.x, s.y, R * 0.6, 0, U.TAU); ctx.fill();
          ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(s.x, s.y, R, 0, U.TAU); ctx.fill();
        }
      }
      // 敌弹标红:双层描红更醒目——外层半透明红晕(宽 7px)+ 内层亮红实芯(宽 3px);
      // 普通合成模式(不进 lighter 层),关闭时零开销
      if (eshotMark) {
        ctx.globalAlpha = 0.4; ctx.strokeStyle = "#ff3b4d"; ctx.lineWidth = 7;
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          if (s.x < view.l || s.x > view.r || s.y < view.t || s.y > view.b) continue;
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 4, 0, U.TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1; ctx.strokeStyle = "#ff5d6e"; ctx.lineWidth = 3;
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          if (s.x < view.l || s.x > view.r || s.y < view.t || s.y > view.b) continue;
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 2, 0, U.TAU); ctx.stroke();
        }
      }
    },

    _glowBeams: function () {
      const beams = SV.Weapons.beams;
      // 光束辉光:默认较宽较亮;环绕激光(lance)整体细化调暗(不遮弹幕),进化版略增强以示机制差异
      for (let i = 0; i < beams.length; i++) {
        const b = beams[i];
        let a = 0.5, gw = 2.4;
        if (b.lance) { a = b.evo ? 0.30 : 0.20; gw = b.evo ? 1.8 : 1.2; }
        ctx.globalAlpha = a * (b.life / b.max); ctx.strokeStyle = b.color; ctx.lineWidth = b.width * gw; this._strokePoly(b.pts);
      }
      ctx.globalAlpha = 1;
    },
    _drawBeams: function () {
      const beams = SV.Weapons.beams;
      for (let i = 0; i < beams.length; i++) {
        const b = beams[i];
        ctx.globalAlpha = (b.lance ? 0.85 : 1) * (b.life / b.max); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = b.width;
        if (b.visualStyle === "rail") { ctx.setLineDash([18,5,3,5]); this._strokePoly(b.pts); ctx.setLineDash([]); }
        else if (b.visualStyle === "lightning") { ctx.lineJoin="bevel"; this._strokePoly(b.pts); }
        else if (b.visualStyle === "spear") { this._strokePoly(b.pts); const q=b.pts[b.pts.length-1],a=Math.atan2(q[1]-b.pts[0][1],q[0]-b.pts[0][0]);ctx.fillStyle="#fff";ctx.beginPath();ctx.moveTo(q[0],q[1]);ctx.lineTo(q[0]-Math.cos(a-.55)*14,q[1]-Math.sin(a-.55)*14);ctx.lineTo(q[0]-Math.cos(a+.55)*14,q[1]-Math.sin(a+.55)*14);ctx.closePath();ctx.fill(); }
        else this._strokePoly(b.pts);
      }
      ctx.globalAlpha = 1;
    },
    _drawSwings: function () {
      const fields = SV.Weapons.arcFields || [];
      for (let i=0;i<fields.length;i++) { const f=fields[i],t=f.life/f.max;if(f.x<view.l-f.outer||f.x>view.r+f.outer||f.y<view.t-f.outer||f.y>view.b+f.outer)continue;ctx.save();ctx.strokeStyle=f.color;ctx.globalAlpha=.16+.2*t;ctx.lineWidth=Math.max(3,f.outer-f.inner);if(f.kind==="sector"){ctx.beginPath();ctx.arc(f.x,f.y,(f.inner+f.outer)/2,f.dir-f.arc/2,f.dir+f.arc/2);ctx.stroke();}else{ctx.lineCap="round";ctx.beginPath();ctx.arc(f.x,f.y,(f.inner+f.outer)/2,f.dir-1.0,f.dir+1.0);ctx.stroke();}ctx.restore(); }
      const swings = SV.Weapons.swings || [];
      for (let i = 0; i < swings.length; i++) {
        const g = swings[i];
        if (g.x < view.l - g.radius || g.x > view.r + g.radius || g.y < view.t - g.radius || g.y > view.b + g.radius) continue;
        const t = g.life / g.max;
        ctx.globalAlpha = (g.visualStyle === "crescent" ? 0.22 : 0.42) * t;
        ctx.fillStyle = g.color;
        ctx.beginPath();
        ctx.moveTo(g.x, g.y);
        ctx.arc(g.x, g.y, g.radius, g.dir - g.arc / 2, g.dir + g.arc / 2);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.85 * t;
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.radius, g.dir - g.arc / 2, g.dir + g.arc / 2);
        ctx.stroke();
        if(g.visualStyle === "spear"){ctx.beginPath();ctx.moveTo(g.x,g.y);ctx.lineTo(g.x+Math.cos(g.dir)*g.radius,g.y+Math.sin(g.dir)*g.radius);ctx.stroke();}
        else if(g.visualStyle === "shockwave"){ctx.globalAlpha=.35*t;ctx.lineWidth=7;ctx.stroke();}
      }
      ctx.globalAlpha = 1;
    },
    _strokePoly: function (pts) {
      if (!pts || pts.length < 2) return;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    },

    _glowPlayer: function (state) {
      const p = state.player;
      const ch = SV.Config.CHARACTERS[state.charId];
      const col = (ch && ch.color) || COL.player;
      ctx.globalAlpha = 0.9; ctx.drawImage(glow(col), p.x - p.r * 3, p.y - p.r * 3, p.r * 6, p.r * 6);
      ctx.globalAlpha = 1;
    },
    _drawPlayerCore: function (state) {
      const p = state.player;
      if (p.iframes > 0 && (Math.floor(p.iframes * 20) % 2 === 0)) { /* 闪烁:本帧不绘核心 */ }
      else {
        const ch = SV.Config.CHARACTERS[state.charId] || {};
        const app = ch.appearance || { shape: "circle" };
        const pcol = ch.color || COL.player;
        // 玩家轮廓默认朝上；整体转到 facing，使非圆形角色、装饰与前缘箭头保持固定相对位置。
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.facing + Math.PI / 2);
        ctx.fillStyle = pcol; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
        drawShapePath(ctx, 0, 0, p.r, app.shape); ctx.fill(); ctx.stroke();
        ctx.fillStyle = COL.playerCore; ctx.beginPath(); ctx.arc(0, 0, p.r * 0.45, 0, U.TAU); ctx.fill();
        this._drawCharDeco(state, app.deco);
        // 朝向指示：钝角折线沿人物外圈展开，辉光/白边/亮色内芯复用角色本体的视觉层次。
        ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.42;
        ctx.drawImage(glow(pcol), -p.r * 0.36, -p.r * 1.82, p.r * 0.72, p.r * 0.72); ctx.restore();
        ctx.globalAlpha = 0.98; ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.beginPath(); ctx.moveTo(-p.r * 0.23, -p.r * 1.30); ctx.lineTo(0, -p.r * 1.54); ctx.lineTo(p.r * 0.23, -p.r * 1.30);
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 4; ctx.stroke();
        ctx.strokeStyle = brighten(pcol, 0.25); ctx.lineWidth = 2.2; ctx.stroke(); ctx.restore();
      }
      // 玩家头顶血条(常驻)
      const bw = p.r * 2.4, bx = p.x - bw / 2, by = p.y - p.r - 15;
      const hpPct = U.clamp(p.hp / p.maxHp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
      ctx.fillStyle = hpPct < 0.3 ? "#ff3d5a" : "#ff7d8e"; ctx.fillRect(bx, by, bw * hpPct, 4);

      // 旋转光刃 + 哨卫炮塔
      this._drawCharacterAbility(state);
      this._drawBlades(state);
      this._drawSentries(state);
    },
    _drawCharacterAbility: function (state) {
      const p=state.player,t=state.time||0;ctx.save();ctx.globalCompositeOperation="lighter";
      if(state.special==="collector"){
        const n=state.collectorCrystals||0;for(let i=0;i<n;i++){const a=t*2.4+i/Math.max(1,n)*U.TAU,x=p.x+Math.cos(a)*30,y=p.y+Math.sin(a)*30;ctx.globalAlpha=.8;ctx.fillStyle="#ffd86b";ctx.beginPath();ctx.moveTo(x,y-6);ctx.lineTo(x+4,y);ctx.lineTo(x,y+6);ctx.lineTo(x-4,y);ctx.closePath();ctx.fill();}
      }
      const ghosts=state.afterimages||[];for(let i=0;i<ghosts.length;i++){const g=ghosts[i],a=U.clamp(g.delay/g.max,0,1);ctx.globalAlpha=.18+.28*a;ctx.strokeStyle="#73dcff";ctx.lineWidth=2;drawShapePath(ctx,g.x,g.y,p.r*(1.2-a*.2),"star");ctx.stroke();ctx.beginPath();ctx.arc(g.x,g.y,70*(1-a*.35),0,U.TAU);ctx.stroke();}
      if(state.overclockActive>0){ctx.globalAlpha=.45+.25*Math.sin(t*18);ctx.strokeStyle="#ffb25a";ctx.lineWidth=3;ctx.beginPath();ctx.arc(p.x,p.y,p.r*2.1,0,U.TAU);ctx.stroke();}
      if(state.timeFractureActive>0){ctx.globalAlpha=.28;ctx.strokeStyle="#9be7ff";ctx.lineWidth=2;ctx.setLineDash([8,5]);ctx.beginPath();ctx.arc(p.x,p.y,58+t%1*16,0,U.TAU);ctx.stroke();ctx.setLineDash([]);}
      ctx.restore();
    },
    _drawBlades: function (state) {
      const p = state.player, blades = p.blades, aura = p.bladeAuraVisual;
      if (!blades || !blades.length) return;
      // 湮灭之轮判定圆盘：边界与结算脉冲在低特效模式仍完整保留，仅省略大面积辉光。
      if (aura && aura.radius > 0) {
        const reduced = SV.Effects.isReduced(), pulse = U.clamp(aura.pulse || 0, 0, 1), r = aura.radius;
        ctx.save();
        if (!reduced) {
          ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.11;
          ctx.drawImage(glow(aura.color || "#ffd0a0"), p.x - r, p.y - r, r * 2, r * 2);
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "rgba(255,218,150," + (reduced ? 0.035 : 0.065) + ")";
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, U.TAU); ctx.fill();
        ctx.strokeStyle = aura.color || "#ffd0a0"; ctx.globalAlpha = reduced ? 0.62 : 0.78; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, U.TAU); ctx.stroke();
        ctx.globalAlpha = (reduced ? 0.38 : 0.62) * (1 - pulse * 0.45); ctx.lineWidth = reduced ? 2 : 4;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * (0.2 + 0.8 * pulse), 0, U.TAU); ctx.stroke();
        ctx.restore();
      }
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < blades.length; i++) {
        const b = blades[i];
        if (b.x < view.l || b.x > view.r || b.y < view.t || b.y > view.b) continue;
        if (!SV.Effects.isReduced()) { ctx.globalAlpha = 0.9; ctx.drawImage(glow(aura ? "#ffd0a0" : "#cfefff"), b.x - 20, b.y - 20, 40, 40); }
      }
      ctx.globalAlpha = 1; ctx.restore();
      // 刃体:带白色亮核的长刃菱形(与圆形弹丸拉开辨识度)
      for (let i = 0; i < blades.length; i++) {
        const b = blades[i];
        if (b.x < view.l || b.x > view.r || b.y < view.t || b.y > view.b) continue;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.angle);
        ctx.fillStyle = aura ? "#ffd58a" : "#8ef0ff"; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(0, 4); ctx.lineTo(-10, 0); ctx.lineTo(0, -4); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.stroke();
        ctx.restore();
      }
    },
    _drawSentries: function (state) {
      const arr = state.player.sentries;
      if (!arr || !arr.length) return;
      // 拦截范围标识:淡辉光圆盘 + 虚线描边环(显眼地标出"弹幕清除区")
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i], ir = s.interceptR || 26;
        if (s.x + ir < view.l || s.x - ir > view.r || s.y + ir < view.t || s.y - ir > view.b) continue;
        ctx.globalAlpha = 0.12; ctx.drawImage(glow("#ffd86b"), s.x - ir, s.y - ir, ir * 2, ir * 2);
      }
      ctx.globalAlpha = 1; ctx.restore();
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i], ir = s.interceptR || 26;
        if (s.x + ir < view.l || s.x - ir > view.r || s.y + ir < view.t || s.y - ir > view.b) continue;
        ctx.save(); ctx.globalAlpha = 0.4; ctx.strokeStyle = "#ffd86b"; ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(s.x, s.y, ir, 0, U.TAU); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
      }
      // 塔体辉光
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        if (s.x < view.l || s.x > view.r || s.y < view.t || s.y > view.b) continue;
        ctx.globalAlpha = 0.9; ctx.drawImage(glow("#ffd86b"), s.x - 18, s.y - 18, 36, 36);
      }
      ctx.globalAlpha = 1; ctx.restore();
      // 塔身:外底盘环 + 实心核心 + 白色中心(炮塔造型,非弹丸)
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        if (s.x < view.l || s.x > view.r || s.y < view.t || s.y > view.b) continue;
        ctx.strokeStyle = "#ffd86b"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, U.TAU); ctx.stroke();
        ctx.fillStyle = "#ffe9a8"; ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, U.TAU); ctx.fill();
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, U.TAU); ctx.fill();
      }
    },
    // 角色装饰(cheap 叠加,按 deco key 分发)
    _drawCharDeco: function (state, deco) {
      const p = state.player;
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      if (deco === "ring") {
        ctx.globalAlpha = 0.5; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, p.r * 1.3, 0, U.TAU); ctx.stroke();
      } else if (deco === "spark") {
        ctx.globalAlpha = 0.6; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-p.r, 0); ctx.lineTo(p.r, 0); ctx.moveTo(0, -p.r); ctx.lineTo(0, p.r); ctx.stroke();
      } else if (deco === "dagger") {
        ctx.globalAlpha = 0.5; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5;
        for (let k = 0; k < 4; k++) { const a = k * U.TAU / 4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * p.r * 0.5, Math.sin(a) * p.r * 0.5); ctx.lineTo(Math.cos(a) * p.r, Math.sin(a) * p.r); ctx.stroke(); }
      } else if (deco === "magnet") {
        ctx.globalAlpha = 0.4; ctx.strokeStyle = "#ffd86b"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, p.r * 1.5, 0, U.TAU); ctx.stroke();
      } else if (deco === "rage") {
        ctx.globalAlpha = 0.6; ctx.strokeStyle = "#ff3d5a"; ctx.lineWidth = 2;
        drawShapePath(ctx, 0, 0, p.r * 1.15, "square"); ctx.stroke();
      } else if (deco === "clock") {
        ctx.globalAlpha = 0.5; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1;
        for (let k = 0; k < 6; k++) { const a = k * U.TAU / 6; ctx.beginPath(); ctx.moveTo(Math.cos(a) * p.r * 0.8, Math.sin(a) * p.r * 0.8); ctx.lineTo(Math.cos(a) * p.r, Math.sin(a) * p.r); ctx.stroke(); }
      } else if (deco === "core") {
        ctx.globalAlpha = 0.5; ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(0, 0, p.r * 0.3, 0, U.TAU); ctx.fill();
      }
      ctx.restore();
    }
  };

  SV.Renderer = Renderer;
  SV.Renderer.drawShapePath = drawShapePath; // 供 menus 怪物图鉴绘制真实形状
  SV.Renderer.drawEnemyPortrait = drawEnemyPortrait;
})();
