// effects.js — SV.Effects: 池化粒子 + 浮动伤害数字 + 屏幕震动。世界空间绘制,辉光用加性混合批量。
(function () {
  "use strict";
  const SV = window.SV;
  const U = SV.Util;
  const MAXP = SV.Config.CONST.MAX_PARTICLES;
  const MAXF = SV.Config.CONST.MAX_FLOATERS;

  function pFactory() { return { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, color: "#fff", kind: "spark", drag: 3, r: 0, rGrow: 0, w: 2 }; }
  function pReset(p) { p.vx = 0; p.vy = 0; p.life = 0; p.max = 1; p.size = 2; p.color = "#fff"; p.kind = "spark"; p.drag = 3; p.r = 0; p.rGrow = 0; p.w = 2; }
  const particles = SV.Pool.create(pFactory, pReset);

  const floaters = []; // {x,y,vy,life,max,text,color,size}
  let reducedFx = false;

  let shakeT = 0, shakeMag = 0, shakeX = 0, shakeY = 0;

  function spark(x, y, vx, vy, color, life, size, drag) {
    if (particles.count() >= MAXP) return;
    const p = particles.acquire();
    p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.color = color; p.life = life; p.max = life; p.size = size; p.drag = drag == null ? 3 : drag; p.kind = "spark";
  }
  function ring(x, y, color, r0, r1, life, w) {
    if (particles.count() >= MAXP) return;
    const p = particles.acquire();
    p.x = x; p.y = y; p.color = color; p.r = r0; p.rGrow = (r1 - r0) / life; p.life = life; p.max = life; p.w = w; p.kind = "ring"; p.vx = 0; p.vy = 0;
  }

  const Effects = {
    init: function () { reducedFx = !!SV.Storage.get("reducedFx"); },
    setReducedFx: function (v) { reducedFx = !!v; },
    isReduced: function () { return reducedFx; },
    clear: function () { particles.clear(); floaters.length = 0; shakeT = 0; },

    // 便捷工厂
    hit: function (x, y, color) {
      const n = reducedFx ? 2 : 4;
      for (let i = 0; i < n; i++) { const a = U.rand(0, U.TAU), s = U.rand(40, 150); spark(x, y, Math.cos(a) * s, Math.sin(a) * s, color, U.rand(0.18, 0.36), U.rand(1.5, 3), 4); }
    },
    explosion: function (x, y, color, count) {
      count = count || (reducedFx ? 8 : 18);
      for (let i = 0; i < count; i++) { const a = U.rand(0, U.TAU), s = U.rand(60, 260); spark(x, y, Math.cos(a) * s, Math.sin(a) * s, color, U.rand(0.3, 0.7), U.rand(2, 4.5), 2.4); }
      ring(x, y, color, 4, 60, 0.4, 3);
    },
    trail: function (x, y, color) { if (!reducedFx) spark(x, y, U.rand(-10, 10), U.rand(-10, 10), color, 0.25, U.rand(1.5, 3), 3); },
    ring: ring,
    death: function (x, y, color) { this.explosion(x, y, color, reducedFx ? 6 : 12); },
    levelBurst: function (x, y) {
      const gold = SV.Config.COLORS.gold;
      for (let i = 0; i < (reducedFx ? 10 : 26); i++) { const a = U.rand(0, U.TAU), s = U.rand(80, 280); spark(x, y, Math.cos(a) * s, Math.sin(a) * s, gold, U.rand(0.4, 0.9), U.rand(2, 4), 1.8); }
      ring(x, y, gold, 8, 120, 0.6, 4);
    },
    // 浮动伤害/文字
    text: function (x, y, str, color, size) {
      if (floaters.length >= MAXF) floaters.shift();
      floaters.push({ x: x, y: y, vy: -42, life: 0.7, max: 0.7, text: str, color: color || "#fff", size: size || 14 });
    },
    shake: function (mag, dur) {
      if (reducedFx) mag *= 0.4;
      if (mag > shakeMag || dur > shakeT) { shakeMag = mag; shakeT = Math.max(shakeT, dur); }
    },
    shakeOffset: function () { return (shakeT > 0) ? { x: shakeX, y: shakeY } : { x: 0, y: 0 }; },

    update: function (dt) {
      // 粒子
      particles.sweep(function (p) {
        p.life -= dt;
        if (p.life <= 0) return false;
        if (p.kind === "ring") { p.r += p.rGrow * dt; }
        else { p.x += p.vx * dt; p.y += p.vy * dt; const f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; }
        return true;
      });
      // 浮字
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i]; f.life -= dt; f.y += f.vy * dt; f.vy *= Math.exp(-1.5 * dt);
        if (f.life <= 0) floaters.splice(i, 1); // 数量小,splice 可接受
      }
      // 震动(幅值随剩余时间衰减)
      if (shakeT > 0) {
        shakeT -= dt;
        const k = Math.max(0, Math.min(1, shakeT / 0.25));
        shakeX = U.rand(-1, 1) * shakeMag * k;
        shakeY = U.rand(-1, 1) * shakeMag * k;
        if (shakeT <= 0) { shakeX = 0; shakeY = 0; shakeMag = 0; }
      }
    },

    // 世界空间绘制(ctx 已处于相机变换内)
    draw: function (ctx, view) {
      // 辉光粒子 + 环(加性混合,整批一次)
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const list = particles.list;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (view && (p.x < view.l || p.x > view.r || p.y < view.t || p.y > view.b)) continue;
        const a = Math.max(0, p.life / p.max);
        if (p.kind === "ring") {
          ctx.globalAlpha = a * 0.8; ctx.strokeStyle = p.color; ctx.lineWidth = p.w;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, U.TAU); ctx.stroke();
        } else {
          ctx.globalAlpha = a; ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, U.TAU); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // 浮动文字(普通混合,屏幕朝向)
      ctx.save();
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (let i = 0; i < floaters.length; i++) {
        const f = floaters[i];
        if (view && (f.x < view.l || f.x > view.r || f.y < view.t || f.y > view.b)) continue;
        const a = Math.max(0, f.life / f.max);
        ctx.globalAlpha = a; ctx.fillStyle = f.color; ctx.font = "bold " + f.size + "px ui-monospace, monospace";
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  };

  SV.Effects = Effects;
})();
