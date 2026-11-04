// input.js — SV.Input: 键盘 + 浮动摇杆 + 桌面鼠标,统一输出 axis 向量
// 浮动摇杆:触摸屏幕(任意无按钮位置)即在该点出现虚拟摇杆;多指追踪防止第二指干扰;
// 桌面键盘 WASD/方向键并行;调试时鼠标可拖动左半区触发摇杆。
(function () {
  "use strict";
  const SV = window.SV;

  const Input = {
    axis: { x: 0, y: 0 },          // 归一化移动向量 [-1,1]
    pausePressed: false,           // 边沿触发(消费式)
    confirmPressed: false,
    muteToggle: false,
    isTouch: ("ontouchstart" in window) || (navigator.maxTouchPoints > 0),
    _keys: {},
    _stick: null,                  // DOM 摇杆视觉元素(浮动摇杆)
    _knob: null,
    _zone: null,                   // 触控全屏层(浮动摇杆事件源)
    _active: false,
    _pointerId: null,              // Pointer Events 主路径:只捕获控制摇杆的这一指
    _touchId: null,                // 当前驱动摇杆的 touch identifier(多指追踪)
    _mouseActive: false,           // 桌面鼠标调试
    _originX: 0, _originY: 0,
    _curX: 0, _curY: 0,
    _R: 60,                         // 摇杆活动半径(像素)
    _safe: { top: 0, right: 0, bottom: 0, left: 0 },  // env(safe-area-inset-*) 缓存

    init: function (stickEl, knobEl, zoneEl) {
      const self = this;
      this._stick = stickEl;
      this._knob = knobEl;
      this._zone = zoneEl;
      this._readSafeInset();

      window.addEventListener("keydown", function (e) {
        if (e.repeat) return;
        const k = e.key.toLowerCase();
        self._keys[k] = true;
        if (k === "p" || k === "escape") self.pausePressed = true;
        if (k === "m") self.muteToggle = true;
        if (k === "enter" || k === " ") self.confirmPressed = true;
        // 防止方向键/空格滚动页面
        if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].indexOf(k) >= 0) e.preventDefault();
      });
      window.addEventListener("keyup", function (e) { self._keys[e.key.toLowerCase()] = false; });
      window.addEventListener("blur", function () { self._keys = {}; self.cancelPointer(); });

      if (zoneEl) this._bindZone(zoneEl, stickEl);
      else if (stickEl) this._bindStick(stickEl);   // 退路:无 zone 时沿用旧固定摇杆
      // 某些移动浏览器在第二指落下时会把第一指升级为系统多指手势并取消后续 click。
      // 摇杆已按住时,第二指按下交互控件便立即转成一次 click；preventDefault 防抬手再触发重复点击。
      if (window.PointerEvent) document.addEventListener("pointerdown", function (e) {
        if (!self._active || e.pointerId === self._pointerId || !e.target || !e.target.closest) return;
        const target = e.target.closest("button, [data-act], .card");
        if (!target) return;
        e.preventDefault(); e.stopPropagation(); target.click();
      }, true);
      if (this.isTouch) document.body.classList.add("touch");
      // 横竖屏切换或软键盘弹出时重读安全区
      window.addEventListener("resize", function () { self._readSafeInset(); });
    },

    // 读取 env(safe-area-inset-*) 实际像素值(通过 #safeTest 探测元素的 padding)
    _readSafeInset: function () {
      try {
        const el = document.getElementById("safeTest");
        if (!el) return;
        const st = window.getComputedStyle(el);
        this._safe.top = parseFloat(st.paddingTop) || 0;
        this._safe.right = parseFloat(st.paddingRight) || 0;
        this._safe.bottom = parseFloat(st.paddingBottom) || 0;
        this._safe.left = parseFloat(st.paddingLeft) || 0;
      } catch (e) { /* 旧浏览器/无支持:全 0 */ }
    },

    // 把落点 clamp 到安全区内(避免摇杆中心落在刘海/_home indicator 上)
    _clampToSafe: function (x, y) {
      const W = window.innerWidth, H = window.innerHeight;
      const s = this._safe;
      const pad = 80;  // 距安全边缘最小距离(确保摇杆整体可见)
      const minx = s.left + pad, maxx = W - s.right - pad;
      const miny = s.top + pad, maxy = H - s.bottom - pad;
      if (maxx < minx) { minx = (s.left + W - s.right) / 2; maxx = minx; }
      if (maxy < miny) { miny = (s.top + H - s.bottom) / 2; maxy = miny; }
      return {
        x: x < minx ? minx : (x > maxx ? maxx : x),
        y: y < miny ? miny : (y > maxy ? maxy : y)
      };
    },

    // 浮动摇杆:绑定全屏 zone,touchstart 落点出现摇杆
    _bindZone: function (zone, stick) {
      const self = this;

      // 是否点击在按钮/卡片/输入等可交互元素上(若是,放弃接管,让该元素处理)
      function onInteractive(target) {
        if (!target || !target.closest) return false;
        return !!target.closest("button, .hud-btn, [data-act], input, .card, .vol-slider, a, .screen");
      }

      // ── Pointer Events 主路径。捕获只属于摇杆的 pointerId,第二指仍可独立命中 HUD。──
      if (window.PointerEvent) {
        zone.addEventListener("pointerdown", function (e) {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          if (self._active || onInteractive(e.target)) return;
          e.preventDefault();
          self._pointerId = e.pointerId;
          try { zone.setPointerCapture(e.pointerId); } catch (err) {}
          self._begin(e.clientX, e.clientY, e.pointerId);
        });
        zone.addEventListener("pointermove", function (e) {
          if (!self._active || e.pointerId !== self._pointerId) return;
          e.preventDefault(); self._move(e.clientX, e.clientY);
        });
        const finishPointer = function (e) {
          if (!self._active || e.pointerId !== self._pointerId) return;
          e.preventDefault();
          try { if (zone.hasPointerCapture(e.pointerId)) zone.releasePointerCapture(e.pointerId); } catch (err) {}
          self._pointerId = null; self._end();
        };
        zone.addEventListener("pointerup", finishPointer);
        zone.addEventListener("pointercancel", finishPointer);
      } else {
        // 旧 Android/iOS WebView 回退。
        zone.addEventListener("touchstart", function (e) {
        if (self._active) return;                       // 已有手指控制摇杆
        if (onInteractive(e.target)) return;            // 点中按钮等:放弃
        const t = e.changedTouches[0];
        if (!t) return;
        e.preventDefault();
        self._begin(t.clientX, t.clientY, t.identifier);
        }, { passive: false });

        zone.addEventListener("touchmove", function (e) {
        if (!self._active) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === self._touchId) {
            e.preventDefault();
            self._move(t.clientX, t.clientY);
            break;
          }
        }
        }, { passive: false });

        const finishTouch = function (e) {
        if (!self._active) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === self._touchId) {
            e.preventDefault();
            self._end();
            break;
          }
        }
        };
        zone.addEventListener("touchend", finishTouch, { passive: false });
        zone.addEventListener("touchcancel", finishTouch, { passive: false });
      }

      // ── 桌面鼠标分支(调试用:仅在显式添加 body.touch 时启用) ──
      if (!window.PointerEvent) zone.addEventListener("mousedown", function (e) {
        if (self._active || self._mouseActive) return;
        if (onInteractive(e.target)) return;
        e.preventDefault();
        self._mouseActive = true;
        self._begin(e.clientX, e.clientY, "mouse");
      });
      window.addEventListener("mousemove", function (e) {
        if (!self._mouseActive) return;
        self._move(e.clientX, e.clientY);
      });
      window.addEventListener("mouseup", function () {
        if (!self._mouseActive) return;
        self._mouseActive = false;
        self._end();
      });
    },

    // 启动摇杆:落点出现视觉摇杆,记录 identifier
    _begin: function (x, y, id) {
      const c = this._clampToSafe(x, y);
      this._originX = c.x; this._originY = c.y;
      this._touchId = id;
      this._active = true;
      const s = this._stick;
      if (s) {
        s.style.transform = "translate(" + c.x + "px," + c.y + "px)";
        s.classList.add("active");
      }
      this._move(c.x, c.y);
    },

    _move: function (x, y) {
      let dx = x - this._originX, dy = y - this._originY;
      const d = Math.hypot(dx, dy);
      const r = this._R;
      if (d > r) { dx = dx / d * r; dy = dy / d * r; }
      this._curX = dx; this._curY = dy;
      if (this._knob) this._knob.style.transform = "translate(" + dx + "px," + dy + "px)";
    },
    _end: function () {
      this._active = false;
      this._pointerId = null;
      this._touchId = null;
      this._resetStick();
    },
    cancelPointer: function () {
      if (this._zone && this._pointerId != null) {
        try { if (this._zone.hasPointerCapture(this._pointerId)) this._zone.releasePointerCapture(this._pointerId); } catch (e) {}
      }
      this._mouseActive = false;
      this._end();
      this.axis.x = 0; this.axis.y = 0;
    },
    _resetStick: function () {
      this._curX = 0; this._curY = 0;
      if (this._knob) this._knob.style.transform = "translate(0,0)";
      const s = this._stick;
      if (s) {
        s.classList.remove("active");
        s.style.transform = "";  // 浮动摇杆:不保留位置
      }
    },

    // 退路:无 zone 时沿用旧固定摇杆事件源(挂 stick 元素本身)
    _bindStick: function (el) {
      const self = this;
      const start = function (x, y) {
        self._active = true;
        const r = el.getBoundingClientRect();
        self._originX = r.left + r.width / 2;
        self._originY = r.top + r.height / 2;
        self._move(x, y);
        if (self._stick) self._stick.classList.add("active");
      };
      const move = function (x, y) { if (self._active) self._move(x, y); };
      const end = function () { self._active = false; self._resetStick(); };

      el.addEventListener("touchstart", function (e) { e.preventDefault(); const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: false });
      el.addEventListener("touchmove", function (e) { e.preventDefault(); const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: false });
      el.addEventListener("touchend", function (e) { e.preventDefault(); end(); }, { passive: false });
      el.addEventListener("touchcancel", function (e) { e.preventDefault(); end(); }, { passive: false });
      el.addEventListener("mousedown", function (e) { e.preventDefault(); start(e.clientX, e.clientY); });
      window.addEventListener("mousemove", function (e) { move(e.clientX, e.clientY); });
      window.addEventListener("mouseup", function () { end(); });
    },

    // 每帧由 game 调用:合成键盘与摇杆
    update: function () {
      let x = 0, y = 0;
      const k = this._keys;
      if (k["a"] || k["arrowleft"]) x -= 1;
      if (k["d"] || k["arrowright"]) x += 1;
      if (k["w"] || k["arrowup"]) y -= 1;
      if (k["s"] || k["arrowdown"]) y += 1;
      if (x || y) {
        const m = Math.hypot(x, y) || 1;
        this.axis.x = x / m; this.axis.y = y / m;
      } else if (this._active) {
        this.axis.x = this._curX / this._R;
        this.axis.y = this._curY / this._R;
      } else {
        this.axis.x = 0; this.axis.y = 0;
      }
    },

    // 消费式读取边沿事件
    consumePause: function () { const v = this.pausePressed; this.pausePressed = false; return v; },
    consumeConfirm: function () { const v = this.confirmPressed; this.confirmPressed = false; return v; },
    consumeMute: function () { const v = this.muteToggle; this.muteToggle = false; return v; }
  };

  SV.Input = Input;
})();
