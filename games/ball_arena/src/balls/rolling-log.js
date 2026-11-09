(function initializeRollingLog(root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") } : root.BallBattle);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function ({ registerBall, resolveArenaGeometry }) {
  const EPS = 1e-8;
  function feedback({ ball, services }) {
    services.spawnParticleBurst({ x: ball.x, y: ball.y, count: 8,
      colors: ["#dddddd", "#ffffff"], minDiameter: 1, maxDiameter: 3,
      minSpeed: 25, maxSpeed: 75, life: .25 });
  }
  function createSmallLogDefinition(side) {
    const axis = side < 2 ? "x" : "y";
    const positive = side % 2 === 0;
    return {
      id: "rolling-log-small", name: "小滚木", englishName: "Small Rolling Log",
      color: "#ffffff", stats: { radius: 10, speed: 150, maxHp: 1 },
      summonsCountForTeamSurvival: false,
      healthless: true,
      createBehavior() {
        let entering = true;
        let entryNormal = null;
        return {
          onSpawn({ ball, game }) {
            const arena = resolveArenaGeometry(game);
            if (arena.shape === "circle") {
              const dx = arena.centerX - ball.x, dy = arena.centerY - ball.y;
              const length = Math.hypot(dx, dy) || 1;
              entryNormal = { x: dx / length, y: dy / length };
              ball.x = arena.centerX - entryNormal.x * arena.width / 2;
              ball.y = arena.centerY - entryNormal.y * arena.width / 2;
              ball.prevX = ball.x; ball.prevY = ball.y;
              return;
            }
            ball[axis] = axis === "x" ? (positive ? arena.left : arena.right) : (positive ? arena.top : arena.bottom);
            ball[axis === "x" ? "prevX" : "prevY"] = ball[axis];
          },
          afterUpdateStep({ ball, game }) {
            if (resolveArenaGeometry(game).contains(ball.x, ball.y, ball.radius)) entering = false;
          },
          getWallMode({ ball, game }) {
            const p = ball[axis], r = ball.radius;
            const arena = resolveArenaGeometry(game);
            if (entryNormal) {
              const dx = ball.x - arena.centerX, dy = ball.y - arena.centerY;
              return entering || (dx * entryNormal.x + dy * entryNormal.y > 0 &&
                Math.hypot(dx, dy) > arena.width / 2 - r - 1) ? "wrap" : "bounce";
            }
            const low = axis === "x" ? arena.left : arena.top, high = axis === "x" ? arena.right : arena.bottom;
            return entering || (positive ? p > high-r-1 : p < low+r+1) ? "wrap" : "bounce";
          },
          onArenaWrap({ ball, game, wrappedX, wrappedY }) {
            const crossedAxis = entryNormal ? wrappedX || wrappedY : axis === "x" ? wrappedX : wrappedY;
            const velocity = entryNormal ? ball.vx * entryNormal.x + ball.vy * entryNormal.y : axis === "x" ? ball.vx : ball.vy;
            if (crossedAxis && (entryNormal ? velocity > 0 : positive ? velocity > 0 : velocity < 0)) {
              // Summons are combatants, not Combat Entities. Retire silently so
              // the wrapped position cannot render, collide or remain a target.
              ball.hp = 0;
              ball.active = false;
              ball.fade = 0;
              ball.deathNotified = true;
              ball.diedAt = null;
              ball.vx = ball.vy = ball.storedVx = ball.storedVy = 0;
              return;
            }
            // A glancing corner must not wrap to the opposite side of the arena.
            for (const [key, crossed, v, stored] of [["x",wrappedX,"vx","storedVx"],["y",wrappedY,"vy","storedVy"]]) {
              if (!crossed) continue;
              const arena = resolveArenaGeometry(game);
              const low = key === "x" ? arena.left : arena.top, high = key === "x" ? arena.right : arena.bottom;
              ball[key] = ball[v] < 0 ? low + ball.radius : high-ball.radius;
              ball[v] *= -1; ball[stored] *= -1;
            }
          },
          onBeforeDamage(context) { feedback(context); return { amount: 0, showHitText: false }; },
          onCollision({ services }, target) { services.dealDamage(target, 3); },
          drawBody() { return true; },
          getHpDisplay() { return { text: "-1" }; }
        };
      }
    };
  }
  const rollingLogDefinition = {
    id: "rollingLog", name: "滚木", englishName: "Rolling Log", color: "#ffffff",
    blankSelectionCard: true,
    hideSelectionPreview: true,
    description: "不可见本体，碰撞伤害5；每7秒从随机边缘在3秒内陆续释放10至15个不可见滚木，碰撞伤害3，只从对边离场。",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      // All wave deadlines use the behavior/action clock, never wall time.
      let untilWave = 7, wave = null;
      function emit(game) {
        const side = wave.side, axis = side < 2 ? "x" : "y", positive = side % 2 === 0;
        const arena = resolveArenaGeometry(game);
        const progress = Math.random();
        const point = arena.boundaryPoint(["left", "right", "top", "bottom"][side],
          side === 0 || side === 3 ? 1 - progress : progress, 10);
        const angle = Math.atan2(point.normalY, point.normalX)
          + (Math.random()-.5)*Math.PI/2;
        services.spawnSummon(createSmallLogDefinition(side), {
          x: point.x, y: point.y,
          vx: Math.cos(angle)*150, vy: Math.sin(angle)*150
        });
      }
      return {
        update({ game }, dt) {
          untilWave -= dt;
          if (wave) {
            wave.elapsed += dt;
            while (wave.sent < wave.count && wave.elapsed+EPS >= wave.sent*3/wave.count) {
              emit(game); wave.sent++;
            }
          }
          if (untilWave <= EPS) {
            untilWave += 7;
            wave = { side: Math.floor(Math.random()*4), count: 10+Math.floor(Math.random()*6), sent: 0, elapsed: 0 };
            emit(game); wave.sent++;
          }
        },
        getNextTransitionIn() {
          return Math.max(EPS, Math.min(untilWave, wave && wave.sent < wave.count ? wave.sent*3/wave.count-wave.elapsed : Infinity));
        },
        onCollision({ services: contact }, target) { contact.dealDamage(target, 5); },
        onDamaged(context) { feedback(context); },
        drawBody() { return true; },
        onBorrowEnd() { wave = null; },
        onAbilitySealed() { wave = null; }
      };
    }
  };
  registerBall(rollingLogDefinition);
  return { rollingLogDefinition, createSmallLogDefinition };
});
