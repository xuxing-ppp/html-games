// spatial.js — SV.Spatial: 均匀网格 broad-phase。每步 clear→insert,查询只返回候选(调用方做精确判定)。
// ★性能根基:把 O(n*m) 碰撞降到近 O(n)。cell 尺寸 = CONST.CELL(≈2×敌半径)。
(function () {
  "use strict";
  const SV = window.SV;
  const CELL = SV.Config.CONST.CELL;
  const INV = 1 / CELL;

  const cells = new Map();          // key "cx,cy" -> array of items
  let stamp = 0;                    // 查询去重戳(每次查询自增)
  const out = [];                   // 复用的结果数组(查询即用即弃)

  function key(cx, cy) { return cx + "," + cy; }

  const Spatial = {
    clear: function () { cells.clear(); },

    insert: function (obj) {
      const cx = Math.floor(obj.x * INV), cy = Math.floor(obj.y * INV);
      const k = key(cx, cy);
      let arr = cells.get(k);
      if (!arr) { arr = []; cells.set(k, arr); }
      arr.push(obj);
    },

    // 查询圆形覆盖的所有 cell 内对象,填入复用数组并返回。调用方需立即消费。
    queryCircle: function (x, y, r) {
      out.length = 0;
      stamp++;
      const minx = Math.floor((x - r) * INV), maxx = Math.floor((x + r) * INV);
      const miny = Math.floor((y - r) * INV), maxy = Math.floor((y + r) * INV);
      for (let cx = minx; cx <= maxx; cx++) {
        for (let cy = miny; cy <= maxy; cy++) {
          const arr = cells.get(key(cx, cy));
          if (!arr) continue;
          for (let i = 0; i < arr.length; i++) {
            const it = arr[i];
            if (it._sq === stamp) continue;
            it._sq = stamp;
            out.push(it);
          }
        }
      }
      return out;
    }
  };

  SV.Spatial = Spatial;
})();
