(function initializeMooncake(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign(
      {},
      require("../core/ball-registry.js"),
      require("../core/sprite-cache.js")
    )
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createMooncakePlugin({ registerBall, createSpriteCache, resolveDeviceScale }) {
  const SPEED_INTERVAL = 3;
  const SPEED_STEP = 0.5;
  const CONTACT_DAMAGE = 6;
  const SILENCE_DURATION = 1;
  const LIFELINE_THRESHOLD = 10;
  const LIFELINE_HEAL = 30;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  // 设定图配色：饼皮焦边略深、饼面金黄、压模纹路偏暗棕。
  const CRUST_LIGHT = "#d06a2a";
  const CRUST_MID = "#b5541c";
  const CRUST_DARK = "#93400f";
  const FACE_LIGHT = "#f8b271";
  const FACE_MID = "#eb8846";
  const FACE_EDGE = "#d26426";
  const MOLD_DARK = "rgba(143, 55, 15, 0.88)";
  const MOLD_SOFT = "rgba(158, 64, 16, 0.62)";
  const MOLD_LIGHT = "rgba(255, 203, 148, 0.22)";
  const SEED_UNLIT = "#8f3d12";
  const SEED_LIT = "#ffe3a6";
  const SEED_OUTLINE = "rgba(146, 61, 16, 0.9)";
  const SEED_ANGLES = Object.freeze([-Math.PI / 2, -Math.PI / 2 - 0.72, -Math.PI / 2 + 0.72]);
  const CRUMB_COLORS = Object.freeze(["#f4a868", "#d97b38", "#a8491a"]);
  const HEAL_COLORS = Object.freeze(["#fff3d2", "#ffd98f", "#ffe9b5"]);

  const HIT_FLASH_DURATION = 0.1;
  const HIT_SQUASH_DURATION = 0.12;
  const BODY_SPRITE_PADDING = 8;
  // 峰值略超物理半径 1%，让抗锯齿后的可见轮廓仍有完整 30 宽。
  const CRUST_VALLEY = 0.955;
  const CRUST_PEAK = 1.012;
  const mooncakeSprites = createSpriteCache();

  // 饼体是静态形状，每帧只有位置、压扁和透明度在变：烘焙一次后只贴图。
  function paintBakedSeed(ctx, centerX, centerY, radius, angle) {
    const x = centerX + Math.cos(angle) * radius * 0.72;
    const y = centerY + Math.sin(angle) * radius * 0.72;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.scale(1, 0.52);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.072, 0, TWO_PI);
    ctx.fillStyle = SEED_UNLIT;
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 200, 145, 0.30)";
    ctx.lineWidth = radius * 0.013;
    ctx.stroke();
    ctx.restore();
  }

  function paintLitSeeds(ctx, centerX, centerY, radius, litCount, now) {
    if (litCount <= 0) return;
    ctx.save();
    ctx.globalAlpha *= 0.86 + 0.14 * (0.5 + 0.5 * Math.sin(now * 2.6));
    ctx.beginPath();
    for (let i = 0; i < litCount; i += 1) {
      const angle = SEED_ANGLES[i];
      const x = centerX + Math.cos(angle) * radius * 0.72;
      const y = centerY + Math.sin(angle) * radius * 0.72;
      const rotation = angle + Math.PI / 2;
      // 每个椭圆单独起子路径，否则 arc/ellipse 会把上一颗芝麻连成一条线。
      ctx.moveTo(x + radius * 0.072 * Math.cos(rotation), y + radius * 0.072 * Math.sin(rotation));
      ctx.ellipse(
        x, y,
        radius * 0.072,
        radius * 0.0374,
        rotation,
        0,
        TWO_PI
      );
    }
    ctx.fillStyle = SEED_LIT;
    ctx.fill();
    ctx.strokeStyle = SEED_OUTLINE;
    ctx.lineWidth = radius * 0.02;
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < litCount; i += 1) {
      const angle = SEED_ANGLES[i];
      const x = centerX + Math.cos(angle) * radius * 0.72 - radius * 0.014;
      const y = centerY + Math.sin(angle) * radius * 0.72 - radius * 0.016;
      ctx.moveTo(x + radius * 0.016, y);
      ctx.arc(x, y, radius * 0.016, 0, TWO_PI);
    }
    ctx.fillStyle = "rgba(255, 255, 244, 0.9)";
    ctx.fill();
    ctx.restore();
  }

  function petalPath(ctx, radius) {
    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.10);
    ctx.bezierCurveTo(radius * 0.125, -radius * 0.18,
      radius * 0.165, -radius * 0.525, 0, -radius * 0.665);
    ctx.bezierCurveTo(-radius * 0.165, -radius * 0.525,
      -radius * 0.125, -radius * 0.18, 0, -radius * 0.10);
    ctx.closePath();
  }

  function paintPetal(ctx, centerX, centerY, radius, angle) {
    // 先压一层极浅的偏移阴影，让花纹像被模具压进去而不是浮在饼面上。
    ctx.save();
    ctx.translate(centerX + radius * 0.012, centerY + radius * 0.018);
    ctx.rotate(angle);
    petalPath(ctx, radius);
    ctx.fillStyle = "rgba(112, 42, 8, 0.16)";
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(angle);
    petalPath(ctx, radius);
    ctx.fillStyle = "rgba(202, 95, 40, 0.50)";
    ctx.fill();
    ctx.strokeStyle = MOLD_DARK;
    ctx.lineWidth = radius * 0.024;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.17);
    ctx.lineTo(0, -radius * 0.575);
    ctx.strokeStyle = "rgba(248, 196, 145, 0.32)";
    ctx.lineWidth = radius * 0.013;
    ctx.stroke();
    ctx.restore();
  }

  function paintMooncake(ctx, centerX, centerY, radius) {
    // 花边：20 个柔和外凸的模压齿。
    const teeth = 20;
    const samples = teeth * 8;
    ctx.beginPath();
    for (let i = 0; i <= samples; i += 1) {
      const angle = (i / samples) * TWO_PI;
      // 波峰对齐四个正方向：半径 15 的球在 0/90/180/270 度上都要画到 15，
      // 否则左右两端的齿谷会让视觉宽度缩到不足 30。
      const wave = 0.5 + 0.5 * Math.cos(angle * teeth);
      const edge = radius * (CRUST_VALLEY + (CRUST_PEAK - CRUST_VALLEY) * wave);
      const x = centerX + Math.cos(angle) * edge;
      const y = centerY + Math.sin(angle) * edge;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const crust = ctx.createRadialGradient(
      centerX - radius * 0.28, centerY - radius * 0.34, radius * 0.08,
      centerX, centerY, radius
    );
    crust.addColorStop(0, CRUST_LIGHT);
    crust.addColorStop(0.72, CRUST_MID);
    crust.addColorStop(1, CRUST_DARK);
    ctx.fillStyle = crust;
    ctx.fill();
    ctx.strokeStyle = "rgba(104, 40, 8, 0.62)";
    ctx.lineWidth = radius * 0.018;
    ctx.stroke();

    // 焦边内的一道浅色唇口，让饼皮有厚度。
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.918, 0, TWO_PI);
    ctx.strokeStyle = "rgba(255, 194, 136, 0.30)";
    ctx.lineWidth = radius * 0.028;
    ctx.stroke();

    // 饼面：上亮下暗的烘焙渐变。
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.868, 0, TWO_PI);
    const face = ctx.createRadialGradient(
      centerX - radius * 0.26, centerY - radius * 0.30, radius * 0.06,
      centerX, centerY, radius * 0.92
    );
    face.addColorStop(0, FACE_LIGHT);
    face.addColorStop(0.5, FACE_MID);
    face.addColorStop(1, FACE_EDGE);
    ctx.fillStyle = face;
    ctx.fill();

    // 压边：深色主圈 + 外侧窄高光。
    ctx.strokeStyle = MOLD_DARK;
    ctx.lineWidth = radius * 0.030;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.806, 0, TWO_PI);
    ctx.stroke();
    ctx.strokeStyle = MOLD_LIGHT;
    ctx.lineWidth = radius * 0.012;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.828, 0, TWO_PI);
    ctx.stroke();

    // 内圈 + 20 个模压小方格，替代原来的斜网格。
    ctx.strokeStyle = MOLD_SOFT;
    ctx.lineWidth = radius * 0.020;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.748, 0, TWO_PI);
    ctx.stroke();
    for (let i = 0; i < teeth; i += 1) {
      const angle = (i / teeth) * TWO_PI + 0.08;
      ctx.save();
      ctx.translate(
        centerX + Math.cos(angle) * radius * 0.776,
        centerY + Math.sin(angle) * radius * 0.776
      );
      ctx.rotate(angle);
      ctx.fillStyle = "rgba(255, 198, 140, 0.30)";
      ctx.fillRect(-radius * 0.011, -radius * 0.011, radius * 0.022, radius * 0.022);
      ctx.restore();
    }

    // 八瓣模具花。
    for (let i = 0; i < 8; i += 1) {
      paintPetal(ctx, centerX, centerY, radius, -Math.PI / 2 + (i * TWO_PI) / 8);
    }

    // 中心小印。
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.135, 0, TWO_PI);
    ctx.fillStyle = "#d97c3f";
    ctx.fill();
    ctx.strokeStyle = "rgba(145, 56, 14, 0.9)";
    ctx.lineWidth = radius * 0.022;
    ctx.stroke();

    // 蛋液高光。
    const gloss = ctx.createRadialGradient(
      centerX - radius * 0.33, centerY - radius * 0.40, radius * 0.02,
      centerX - radius * 0.33, centerY - radius * 0.40, radius * 0.6
    );
    gloss.addColorStop(0, "rgba(255, 252, 236, 0.34)");
    gloss.addColorStop(0.5, "rgba(255, 240, 210, 0.10)");
    gloss.addColorStop(1, "rgba(255, 240, 210, 0)");
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.862, 0, TWO_PI);
    ctx.fillStyle = gloss;
    ctx.fill();

    for (const angle of SEED_ANGLES) {
      paintBakedSeed(ctx, centerX, centerY, radius, angle);
    }
  }

  function paintMooncakeFlash(ctx, centerX, centerY, radius) {
    paintMooncake(ctx, centerX, centerY, radius);
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(255, 230, 176, 0.5)";
    ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
    ctx.globalCompositeOperation = "source-over";
  }

  function getMooncakeSprite(ctx, radius, flash) {
    const scale = resolveDeviceScale(ctx);
    if (scale === null) return null;
    return mooncakeSprites.get(
      flash ? "mooncake-body-flash-v1" : "mooncake-body-v1",
      radius * 2 + BODY_SPRITE_PADDING,
      scale,
      (spriteContext, centerX, centerY) => {
        if (flash) paintMooncakeFlash(spriteContext, centerX, centerY, radius);
        else paintMooncake(spriteContext, centerX, centerY, radius);
      }
    );
  }

  function drawMooncakeBody(ctx, ball, visuals) {
    const radius = ball.radius;
    ctx.save();
    ctx.translate(ball.x, ball.y);

    // 撞击瞬间轻微横向撑开、纵向压扁；血量数字由渲染器单独绘制，不跟着变形。
    if (visuals.squashProgress >= 0 && visuals.squashProgress < 1) {
      const squeeze = Math.sin(visuals.squashProgress * Math.PI) * 0.065;
      ctx.scale(1 + squeeze, 1 - squeeze);
    }

    const sprite = getMooncakeSprite(ctx, radius, false);
    if (sprite) {
      const width = sprite.worldWidth;
      ctx.drawImage(sprite.canvas, -width / 2, -width / 2, width, width);
    } else {
      paintMooncake(ctx, 0, 0, radius);
    }

    paintLitSeeds(ctx, 0, 0, radius, visuals.litSeeds, visuals.now);
    if (visuals.flashProgress >= 0 && visuals.flashProgress < 1) {
      const alpha = Math.pow(1 - visuals.flashProgress, 1.5) * 0.8;
      const flashSprite = getMooncakeSprite(ctx, radius, true);
      ctx.save();
      ctx.globalAlpha *= alpha;
      if (flashSprite) {
        const width = flashSprite.worldWidth;
        ctx.drawImage(flashSprite.canvas, -width / 2, -width / 2, width, width);
      } else {
        paintMooncakeFlash(ctx, 0, 0, radius);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  const mooncakeDefinition = {
    id: "mooncake",
    name: "月饼",
    englishName: "Mooncake",
    color: "#e26e2c",
    description: "每3秒速度+0.5倍 / 撞人-6血并沉默1秒且速度重置 / 血量≤10一次性回30血",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      // 自身速度走 speedMultiplierBase 通道：外部减速/冻结由效果因子另行合成。
      let ownSpeedFactor = 1;
      let speedTimer = SPEED_INTERVAL;
      let lifelineUsed = false;
      let hitFlashUntil = -Infinity;
      let hitSquashStart = -Infinity;

      function checkLifeline(ball) {
        if (lifelineUsed || ball.hp <= 0 || ball.hp > LIFELINE_THRESHOLD) return;
        lifelineUsed = true;
        ball.hp += LIFELINE_HEAL;
        services.spawnHitText(ball, `+${LIFELINE_HEAL}`, { color: "#8ff0a4" });
        services.spawnParticleBurst({
          kind: "mooncake-heal",
          x: ball.x,
          y: ball.y,
          count: 6,
          colors: HEAL_COLORS.slice(),
          minDiameter: 0.5,
          maxDiameter: 1.4,
          minSpeed: 6,
          maxSpeed: 20,
          directionAngle: -Math.PI / 2,
          directionSpread: 1.5,
          initialRadius: ball.radius * 0.55,
          drag: 2.4,
          gravityY: -14,
          life: 0.5
        });
      }

      return {
        update({ ball }, dt) {
          speedTimer -= Math.max(0, dt);
          while (speedTimer <= EPSILON) {
            speedTimer += SPEED_INTERVAL;
            ownSpeedFactor += SPEED_STEP;
          }
          services.setSpeedMultiplier(ownSpeedFactor);
          checkLifeline(ball);
        },
        updateWhilePaused({ ball }) {
          checkLifeline(ball);
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, speedTimer);
        },
        onCollision(context, target) {
          if (context.blockedAtContact) return;
          const damaged = context.services.dealDamage(target, CONTACT_DAMAGE);
          // 沉默 1 秒：禁止行动与攻击但保留移动，沿用标准眩晕标记。
          context.services.applyEffect(target, {
            id: "mooncake-silence",
            duration: SILENCE_DURATION,
            preventsAttack: true,
            pausesBehavior: true,
            visualType: "stun"
          });
          ownSpeedFactor = 1;
          speedTimer = SPEED_INTERVAL;
          services.setSpeedMultiplier(1);
          if (damaged) {
            const now = context.game && Number.isFinite(context.game.time) ? context.game.time : 0;
            hitFlashUntil = now + HIT_FLASH_DURATION;
            hitSquashStart = now;
            services.spawnParticleBurst({
              kind: "mooncake-crumbs",
              x: (context.ball.x + target.x) / 2,
              y: (context.ball.y + target.y) / 2,
              count: 6,
              colors: CRUMB_COLORS.slice(),
              minDiameter: 0.6,
              maxDiameter: 1.7,
              minSpeed: 14,
              maxSpeed: 42,
              directionAngle: Math.atan2(target.y - context.ball.y, target.x - context.ball.x),
              directionSpread: 2.2,
              initialRadius: 1.5,
              drag: 3.4,
              gravityY: 60,
              life: 0.34
            });
          }
        },
        onDamaged({ ball }) {
          checkLifeline(ball);
        },
        drawBody({ ball, game }, ctx) {
          const now = game && Number.isFinite(game.time) ? game.time : 0;
          drawMooncakeBody(ctx, ball, {
            now,
            litSeeds: Math.min(
              SEED_ANGLES.length,
              Math.max(0, Math.round((ownSpeedFactor - 1) / SPEED_STEP))
            ),
            flashProgress: hitFlashUntil > now
              ? 1 - (hitFlashUntil - now) / HIT_FLASH_DURATION
              : 1,
            squashProgress: hitSquashStart >= 0
              ? (now - hitSquashStart) / HIT_SQUASH_DURATION
              : 1
          });
          return true;
        },
        onBorrowEnd() {
          ownSpeedFactor = 1;
          speedTimer = SPEED_INTERVAL;
          hitFlashUntil = -Infinity;
          hitSquashStart = -Infinity;
        }
      };
    }
  };

  registerBall(mooncakeDefinition);
  return { mooncakeDefinition };
});
