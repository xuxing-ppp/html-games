// util.js — SV.Util: 共享数学/随机工具(无依赖)
(function () {
  "use strict";
  const SV = window.SV;

  const Util = {
    TAU: Math.PI * 2,
    clamp: function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); },
    rand: function (lo, hi) { return lo + Math.random() * (hi - lo); },
    randInt: function (lo, hi) { return Math.floor(lo + Math.random() * (hi - lo + 1)); },
    randSign: function () { return Math.random() < 0.5 ? -1 : 1; },
    choice: function (arr) { return arr[(Math.random() * arr.length) | 0]; },
    chance: function (p) { return Math.random() < p; },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    // 指数平滑趋近(帧率无关): cur += (target-cur) * (1 - exp(-k*dt))
    smooth: function (cur, target, k, dt) { return cur + (target - cur) * (1 - Math.exp(-k * dt)); },
    dist2: function (ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; },
    dist: function (ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); },
    angleTo: function (ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); },
    normalizeAngle: function (a) { a = a % this.TAU; if (a < 0) a += this.TAU; return a; },
    // 每步固定步长逼近
    approach: function (cur, target, step) {
      if (cur < target) return Math.min(cur + step, target);
      if (cur > target) return Math.max(cur - step, target);
      return target;
    },
    fmtTime: function (sec) {
      sec = Math.max(0, Math.floor(sec));
      const m = (sec / 60) | 0, s = sec % 60;
      return m + ":" + (s < 10 ? "0" : "") + s;
    },
    // 加权随机选择,返回 arr 中按 weight 最大的一项;arr=[{...,weight}]
    weighted: function (arr) {
      let sum = 0;
      for (let i = 0; i < arr.length; i++) sum += arr[i].weight;
      if (sum <= 0) return arr[0];
      let r = Math.random() * sum;
      for (let i = 0; i < arr.length; i++) { r -= arr[i].weight; if (r <= 0) return arr[i]; }
      return arr[arr.length - 1];
    },
    hsla: function (h, s, l, a) { return "hsla(" + h + "," + s + "%," + l + "%," + a + ")"; }
  };

  SV.Util = Util;
})();
