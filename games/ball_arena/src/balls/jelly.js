(function initializeJelly(root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/sprite-cache.js")) : root.BallBattle);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createJellyPlugin({ registerBall, createTextSpriteCache }) {
  const EPSILON = 1e-9;
  const TAU = Math.PI * 2;
  const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

  function jellyShape(age, fallen) {
    const blend = fallen ? smooth(age / 0.14) : 1 - smooth(age / 0.22);
    const wobble = Math.sin(age * 32) * Math.exp(-age * 7) * 0.055;
    return { x: 1 + blend * 0.65 + wobble, y: 1 - blend * 0.49 - wobble * 0.5, blend };
  }

  // A round upper dome becomes a wide, nearly flat-bottomed puddle.
  function jellyOutline(ctx, blend) {
    const side = blend * 0.58;
    ctx.beginPath();
    ctx.moveTo(0, -1);
    ctx.bezierCurveTo(0.552, -1, 1, -0.552 + blend * 0.8, 1, side);
    ctx.bezierCurveTo(1, 0.552 + blend * 0.44, 0.552, 1, 0, 1);
    ctx.bezierCurveTo(-0.552, 1, -1, 0.552 + blend * 0.44, -1, side);
    ctx.bezierCurveTo(-1, -0.552 + blend * 0.8, -0.552, -1, 0, -1);
    ctx.closePath();
  }

  function drawJelly(ctx, ball, shape) {
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.scale(ball.radius * shape.x, ball.radius * shape.y);
    jellyOutline(ctx, shape.blend);
    const body = ctx.createRadialGradient(0.35, 0.50, 0.05, -0.1, -0.1, 1.3);
    body.addColorStop(0, "#ed2535"); body.addColorStop(0.43, "#cb1529");
    body.addColorStop(0.78, "#95152d"); body.addColorStop(1, "#ec4e62");
    ctx.fillStyle = body; ctx.fill();
    ctx.strokeStyle = "#9b132b"; ctx.lineWidth = 0.05; ctx.stroke();
    ctx.save(); ctx.clip();
    const sheen = ctx.createLinearGradient(0, -1, 0, 0.6);
    sheen.addColorStop(0, "rgba(255,192,208,0.65)");
    sheen.addColorStop(0.25, "rgba(255,128,153,0.22)");
    sheen.addColorStop(0.65, "rgba(255,115,140,0.07)");
    sheen.addColorStop(1, "rgba(255,115,140,0)");
    ctx.fillStyle = sheen;
    ctx.beginPath(); ctx.moveTo(-0.88, 0.10);
    ctx.bezierCurveTo(-1.02, -0.72, -0.18, -1.16, 0.48, -0.72);
    ctx.bezierCurveTo(1.05, -0.13, 0.28, -0.36, 0.08, -0.22);
    ctx.bezierCurveTo(-0.35, -0.11, -0.6, 0.36, -0.88, 0.10); ctx.fill();
    ctx.strokeStyle = "rgba(255,136,157,0.65)"; ctx.lineWidth = 0.032;
    ctx.save(); ctx.scale(0.955, 0.955); jellyOutline(ctx, shape.blend); ctx.stroke(); ctx.restore();
    ctx.strokeStyle = "#ffe2e9"; ctx.lineWidth = 0.066; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-0.69, -0.43);
    ctx.bezierCurveTo(-0.59, -0.63, -0.46, -0.73, -0.29, -0.79); ctx.stroke();
    ctx.fillStyle = "#ffeaf0";
    for (const [x, y, rx, ry] of [[-0.11,-0.84,0.079,0.029],[-0.79,-0.22,0.025,0.07]]) {
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0.35, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = "rgba(255,157,174,0.20)";
    for (const [x,y,r] of [[-0.62,0.48,0.018],[-0.48,0.62,0.022],[0.65,-0.48,0.016],[-0.79,0.23,0.012],[0.49,0.68,0.012]]) {
      ctx.beginPath(); ctx.arc(x,y,r,0,TAU); ctx.fill();
    }
    ctx.restore(); ctx.restore();
  }

  const jellyDefinition = {
    id: "jelly", name: "\u679c\u51bb", englishName: "Jelly Ball", color: "#cf1936",
    description: "\u78b0\u649e3 / \u6bcf3\u79d2\u6454\u50122\u79d2\u5e76\u65e0\u654c / \u6454\u5012\u81ea\u62632\u8840 / \u89e6\u78b0\u644a\u5f00\u7684\u679c\u51bb\u53d75\u4f24\u5bb3\u5e76\u63a7\u52362\u79d2",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 6,
    createBehavior(services) {
      let fallen = false;
      let timer = 3;
      let age = 1;
      let owner = null;
      const hit = new Set();
      const hpTextCache = createTextSpriteCache();
      const lockId = () => `jelly-fallen-${owner.instanceId}`;
      function finish() {
        fallen = false; age = 0; hit.clear();
        if (owner) services.clearEffect(owner, lockId());
      }
      function step({ ball }, dt) {
        owner = ball; age += dt; timer -= dt;
        if (timer > EPSILON) return;
        if (fallen) { finish(); timer = 1; return; }
        services.dealDamage(ball, 2, ball);
        if (ball.hp <= 0) return;
        fallen = true; age = 0; timer = 2; hit.clear();
        services.applyEffect(ball, {
          id: lockId(), duration: 2, locksMovement: true,
          onApply({ ball }) { ball.vx = ball.vy = 0; },
          update({ ball }) { ball.vx = ball.vy = 0; }
        });
        services.playSound("shoot", { kind: "jelly-fall" });
      }
      return {
        update: step,
        updateWhilePaused(context, dt) { if (fallen) step(context, dt); },
        getNextTransitionIn() { return Math.max(EPSILON, timer); },
        getNextPausedTransitionIn() { return fallen ? Math.max(EPSILON, timer) : undefined; },
        getContactProfile() { return fallen ? { physical: false, targetable: false } : null; },
        onBeforeDamage(context, event) {
          return fallen ? { amount: 0, showHitText: false, cancelAttack: true } : event;
        },
        onCollision(context, target) { if (!fallen) context.services.dealDamage(target, 3); },
        afterUpdateStep({ ball }) {
          if (!fallen || !services.getCapabilities(ball).canDealDamage) return;
          const shape = jellyShape(age, true);
          services.forEachEnemy((target) => {
            const dx = (target.x - ball.x) / (ball.radius * shape.x + target.radius);
            const dy = (target.y - ball.y) / (ball.radius * shape.y + target.radius);
            const inside = dx * dx + dy * dy <= 1 && services.getContactProfile(target).attackable;
            if (!inside) { hit.delete(target.instanceId); return; }
            if (hit.has(target.instanceId)) return;
            hit.add(target.instanceId);
            // 控制只拿行动/攻击，不碰移动与碰撞：locksMovement 在引擎里同时
            // 意味着“碰撞不可推动”，会让被控体无法被本体撞开或转向。
            if (services.dealDamage(target, 5, ball)) services.applyEffect(target, {
              id: `jelly-capture-${ball.instanceId}`, duration: 2,
              pausesBehavior: true, preventsAttack: true, visualType: "stun"
            });
          });
        },
        drawBody({ ball }, ctx) { drawJelly(ctx, ball, jellyShape(age, fallen)); return true; },
        getHpDisplay() { return { hidden: true }; },
        drawAfter({ ball, game }, ctx) {
          const shape = jellyShape(age, fallen);
          ctx.save(); ctx.translate(ball.x, ball.y + 0.7);
          ctx.scale(1 + shape.blend * 0.34, 1 - shape.blend * 0.33);
          ctx.font = "400 10px 'Ball Impact', Impact, Haettenschweiler, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.lineJoin = "round"; ctx.strokeStyle = "#343b3c"; ctx.lineWidth = 1.4;
          ctx.fillStyle = "#ffffff";
          const text = String(Math.ceil(ball.hp));
          const scale = ctx.canvas && game ? ctx.canvas.width / game.arenaSize : undefined;
          if (!hpTextCache.draw(ctx, text, 0, 0, scale)) {
            ctx.strokeText(text, 0, 0);
            ctx.fillText(text, 0, 0);
          }
          ctx.restore();
        },
        onDeath: finish, onBorrowEnd: finish
      };
    }
  };
  registerBall(jellyDefinition);
  return { jellyDefinition, jellyShape, drawJelly };
});
