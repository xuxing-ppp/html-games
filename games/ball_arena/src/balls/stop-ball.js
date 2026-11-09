(function(root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")) : root.BallBattle);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function({ resolveArenaGeometry, registerBall }) {
  const COLOR = "#fb0304";
  function region(ball, size, previous) {
    const arena = resolveArenaGeometry(size);
    size = arena.size;
    return { x: ball.x, y: ball.y, size, arena,
      sx: ball.x === size / 2 && previous ? previous.sx : ball.x <= size / 2 ? 1 : -1,
      sy: ball.y === size / 2 && previous ? previous.sy : ball.y <= size / 2 ? 1 : -1 };
  }
  function createStopRegion(owner) {
    let previous = null;
    let previousOwner = null;
    let contacts = new Set();
    return {
      kind: "stop-ball-region", combatKind: "zone", lifecycle: "owner-bound",
      life: Number.MAX_SAFE_INTEGER, drawLayer: "background", region: null,
      update({ entity, game, services }) {
        const ball = services.getBall(entity.ownerInstanceId);
        if (!ball || ball.hp <= 0) { entity.entityActive = false; return; }
        const current = region(ball, game, previous);
        entity.region = current;
        const old = previous && previousOwner === ball.instanceId && previous.sx === current.sx && previous.sy === current.sy ? previous : current;
        const next = new Set();
        services.forEachContactEnemy(target => {
          const r = target.radius;
          const u = (target.x - current.x) * current.sx;
          const v = (target.y - current.y) * current.sy;
          const px = Number.isFinite(target.prevX) ? target.prevX : target.x;
          const py = Number.isFinite(target.prevY) ? target.prevY : target.y;
          const pu = (px - old.x) * current.sx;
          const pv = (py - old.y) * current.sy;
          if (contacts.has(target.instanceId) && u <= r + 0.5 && v <= r + 0.5) {
            next.add(target.instanceId);
          }
          let axis = null;
          let time = Infinity;
          // 在随本体移动的局部坐标里扫掠两条有限边，捕获高速穿越。
          if (pu > r && u <= r) {
            const t = (pu - r) / (pu - u);
            if (pv + (v - pv) * t <= r) { axis = "x"; time = t; }
          }
          if (pv > r && v <= r) {
            const t = (pv - r) / (pv - v);
            if (pu + (u - pu) * t <= r && t < time) axis = "y";
          }
          const inside = u <= 0 && v <= 0;
          const edgeX = Math.abs(u) <= r && v <= 0;
          const edgeY = Math.abs(v) <= r && u <= 0;
          const corner = u > 0 && v > 0 && u * u + v * v <= r * r;
          if (!axis && (inside || edgeX || edgeY || corner)) axis = u >= v ? "x" : "y";
          if (!axis) return;
          next.add(target.instanceId);
          if (!contacts.has(target.instanceId)) services.dealDamage(target, 5);
          if (target.positionLocked || services.isMovementLocked(target)) return;
          const sign = axis === "x" ? current.sx : current.sy;
          target[axis] = current[axis] + sign * (r + 0.01);
          Object.assign(target, resolveArenaGeometry(game).clampPoint(target.x, target.y, r));
          const velocity = axis === "x" ? "vx" : "vy";
          const stored = axis === "x" ? "storedVx" : "storedVy";
          if (target[velocity] * sign < 0) target[velocity] *= -1;
          if (target[stored] * sign < 0) target[stored] *= -1;
        });
        contacts = next;
        previous = current;
        previousOwner = ball.instanceId;
      },
      draw({ entity, game, services }, canvas) {
        const ball = services.getBall(entity.ownerInstanceId) || owner;
        const q = region(ball, game, entity.region);
        const wx = q.sx === 1 ? q.arena.left : q.arena.right, wy = q.sy === 1 ? q.arena.top : q.arena.bottom;
        canvas.save();
        canvas.fillStyle = "rgba(251,3,4,0.23)";
        canvas.fillRect(Math.min(wx, q.x), Math.min(wy, q.y), Math.abs(q.x - wx), Math.abs(q.y - wy));
        canvas.strokeStyle = COLOR; canvas.lineWidth = 0.85;
        canvas.beginPath(); canvas.moveTo(wx, q.y); canvas.lineTo(q.x, q.y); canvas.lineTo(q.x, wy); canvas.stroke();
        canvas.restore();
      }
    };
  }
  const stopBallDefinition = {
    id: "stopBall", name: "禁止通行", englishName: "Stop Ball", color: COLOR,
    description: "最近角落形成动态禁行区域 / 两条活动边界阻挡反弹、接触5伤 / 本体碰撞5伤",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let field = null;
      function cleanup() { if (field) field.entityActive = false; field = null; }
      return {
        onSpawn({ ball }) { field = services.spawnCombatEntity(createStopRegion(ball)); },
        onCollision(context, target) {
          if (!context.blockedAtContact) context.services.dealDamage(target, 5);
        },
        drawBody({ ball }, canvas) {
          canvas.save(); canvas.fillStyle = COLOR;
          canvas.beginPath(); canvas.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2); canvas.fill();
          canvas.strokeStyle = "#ffffff"; canvas.lineWidth = 0.65; canvas.stroke();
          canvas.fillStyle = "#ffffff";
          canvas.fillRect(ball.x - ball.radius * 0.68, ball.y - ball.radius * 0.13,
            ball.radius * 1.36, ball.radius * 0.26);
          canvas.restore(); return true;
        },
        onBorrowEnd: cleanup, onDeath: cleanup,
        onAttackTransfer() { if (field) field.region = null; }
      };
    }
  };
  registerBall(stopBallDefinition);
  return { stopBallDefinition, createStopRegion };
});
