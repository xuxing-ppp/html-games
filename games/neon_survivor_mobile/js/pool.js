// pool.js — SV.Pool: 通用对象池。owner 负责 spawn 后填充字段、用 sweep 就地回收。
(function () {
  "use strict";
  const SV = window.SV;

  function create(factory, resetFn) {
    const list = [];
    const pool = [];
    return {
      list: list,
      count: function () { return list.length; },
      // 取一个对象(池空则 factory 新建),调用 reset 清零,返回交给调用者填充
      acquire: function () {
        const obj = pool.length ? pool.pop() : factory();
        if (resetFn) resetFn(obj);
        list.push(obj);
        return obj;
      },
      release: function (obj) { pool.push(obj); },
      clear: function () { for (let i = 0; i < list.length; i++) pool.push(list[i]); list.length = 0; },
      // 就地压缩:遍历 list,alive(o)=false 的回收,其余前移。禁止在热循环用 .filter()
      sweep: function (alive) {
        let w = 0;
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          if (alive(it)) { if (w !== i) list[w] = it; w++; }
          else pool.push(it);
        }
        list.length = w;
      }
    };
  }

  SV.Pool = { create: create };
})();
