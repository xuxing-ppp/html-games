(function initializeOnion(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...require("../core/ball-registry.js"),
        ...require("../core/contact-model.js"),
        tearsOfJoyEmojiTexture: require(
          "../assets/emoji/face-with-tears-of-joy-texture.js"
        )
      }
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));

  if (typeof module === "object" && module.exports) module.exports = api;

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createOnionPlugin({ resolveArenaGeometry, registerBall,
  firstSegmentCircleContact,
  tearsOfJoyEmojiTexture = null
}) {
  const TAU = Math.PI * 2;
  const EPSILON = 1e-9;

  const CONTACT_DAMAGE = 5;
  const FIRE_INTERVAL = 4.8;
  const SLIVER_SPEED = 100;
  // 洋葱丝只有雾是攻击；本体不带伤害，壁障处自行收束。
  const SLIVER_RADIUS = 2.5;
  const SLIVER_LIFE = 20;
  // 视觉体积约 70 平方单位：24 长、上缘拱起 5.2 的一段弧形薄片。
  const SLIVER_LENGTH = 24;
  const SLIVER_ARC = 5.2;
  const SLIVER_SAMPLE_SPACING = 3;
  const SLIVER_EDGE_PADDING = 4;
  const FOG_WIDTH = 20;
  const FOG_HALF_WIDTH = FOG_WIDTH / 2;
  const FOG_LIFETIME = 1.6;
  const EMOJI_FADE_IN = 0.8;
  const EMOJI_HOLD = 1;
  const EMOJI_FADE_OUT = 0.6;
  const EMOJI_DURATION = EMOJI_FADE_IN + EMOJI_HOLD + EMOJI_FADE_OUT;
  // 小黄脸直径必须与敌方本体直径一致（半径 = 本体半径）。
  const EMOJI_RADIUS_SCALE = 1;
  const FACE_ASPECT = 1;

  // 紫雾是一串边飞边向四周散开的烟雾团：沿路径铺几层柔边云，
  // 越旧越大、越淡、向外漂得越远。全部用轻量径向渐变，避免贴图切换。
  const FOG_PUFF_MIN_COUNT = 4;
  const FOG_PUFF_MAX_COUNT = 8;
  const FOG_PUFF_SPACING = 24;
  const FOG_PUFF_ALPHA = 0.2;

  // 每累计损失 10 血，朝随机旋转的十字四向发射与主动攻击完全相同的洋葱丝。
  const VOLLEY_TRIGGER_HP = 10;
  const VOLLEY_COUNT = 4;

  // 只用于视觉抖动，不消耗战斗随机数。
  function hash01(value) {
    const x = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function createRadialGradient(context, x0, y0, r0, x1, y1, r1, stops, fallback) {
    if (typeof context.createRadialGradient !== "function") return fallback;
    const gradient = context.createRadialGradient(x0, y0, r0, x1, y1, r1);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    return gradient;
  }

  function createLinearGradient(context, x0, y0, x1, y1, stops, fallback) {
    if (typeof context.createLinearGradient !== "function") return fallback;
    const gradient = context.createLinearGradient(x0, y0, x1, y1);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    return gradient;
  }

  // 渐隐曲线：整个 2.4 秒里按剩余时间给出 0.8s 渐显 / 1s 常显 / 0.6s 渐隐。
  // 高清贴图：脸部像素边界由资源模块给出；缩放时让脸宽等于敌方本体直径。
  let emojiTextureImage = null;

  function getOnionEmojiImage() {
    if (!tearsOfJoyEmojiTexture || typeof Image !== "function") return null;
    if (!emojiTextureImage) {
      emojiTextureImage = new Image();
      emojiTextureImage.src = tearsOfJoyEmojiTexture.dataUrl;
    }
    return emojiTextureImage.complete && emojiTextureImage.naturalWidth > 0
      ? emojiTextureImage
      : null;
  }

  if (typeof Image === "function" && tearsOfJoyEmojiTexture) getOnionEmojiImage();

  function drawOnionEmojiTexture(context, ball, image, alpha) {
    const texture = tearsOfJoyEmojiTexture;
    if (!image || !texture || typeof context.drawImage !== "function") return false;
    const faceDiameter = Number.isFinite(texture.faceDiameter) ? texture.faceDiameter : 0;
    if (faceDiameter <= 0) return false;
    const scale = (ball.radius * 2) / faceDiameter;
    const x = ball.x - texture.faceCenterX * scale;
    const y = ball.y - texture.faceCenterY * scale;
    context.save();
    context.globalAlpha *= alpha;
    // 贴图脸部直径严格等于本体直径；本体自带的 1px 描边会露出外圈，
    // 先用同色橙圈盖住描边，再叠贴图，避免敌人底色在脸边留下细环。
    if (typeof context.arc === "function" && typeof context.stroke === "function") {
      context.beginPath();
      context.arc(ball.x, ball.y, ball.radius, 0, TAU);
      context.lineWidth = 1.2;
      context.strokeStyle = "#f2a000";
      context.stroke();
    }
    context.drawImage(
      image,
      x,
      y,
      texture.width * scale,
      texture.height * scale
    );
    context.restore();
    return true;
  }

  function createOnionEmojiEffect(ownerInstanceId) {
    return {
      id: `onion-emoji-${ownerInstanceId}`,
      duration: EMOJI_DURATION,
      // 受控 2.4 秒：锁行为、锁攻击、封住它已经放出的武器/弹幕。
      // 控制只声明真正需要的能力，不碰移动/碰撞：locksMovement 在引擎里
      // 同时意味着“碰撞不可推动”，会让本体碰撞无法转向。
      pausesBehavior: true,
      preventsAttack: true,
      blocksDamageOutput: true,
      sealsAbilities: true,
      blocksOwnedEntityDamage: true,
      onApply({ effect, isRefresh }) {
        if (!isRefresh || !Number.isFinite(effect.opacity) || !effect.phase) {
          effect.opacity = 0;
          effect.phase = "in";
          return;
        }
        // 再次触雾刷新持续时间；若正在渐隐，从当前透明度反向渐显，
        // 不能把透明度清零重来，否则会出现一次可见的闪烁。
        if (effect.phase === "out") effect.phase = "in";
      },
      update({ effect, game }, dt) {
        const elapsed = Math.max(0, dt);
        const remaining = effect.expiresAt - game.time;
        if (effect.phase === "out") {
          effect.opacity = Math.max(0, effect.opacity - elapsed / EMOJI_FADE_OUT);
          return;
        }
        if (effect.phase === "in") {
          effect.opacity = Math.min(1, effect.opacity + elapsed / EMOJI_FADE_IN);
          if (effect.opacity >= 1) {
            effect.opacity = 1;
            effect.phase = "hold";
          }
          return;
        }
        effect.opacity = 1;
        if (remaining <= EMOJI_FADE_OUT) effect.phase = "out";
      },
      draw({ ball, effect }, context) {
        const alpha = Number.isFinite(effect.opacity) ? effect.opacity : 0;
        if (alpha <= 0) return;
        if (drawOnionEmojiTexture(context, ball, getOnionEmojiImage(), alpha)) return;
        drawOnionEmoji(
          context, ball.x, ball.y, ball.radius * EMOJI_RADIUS_SCALE, alpha
        );
      }
    };
  }

  // 用户给的参考图是苹果版笑哭表情。这里用路径复刻外形：黄色球面 + 橙色
  // 内缘、斜挑的眉毛、闭合的笑眼、露齿大嘴和两侧蓝色泪滴；绘制顺序保证
  // 它盖在本体与血量数字之上（渲染器先写血量、再调用附着状态的 draw）。
  function drawOnionEmoji(context, x, y, radius, alpha) {
    context.save();
    context.translate(x, y);
    context.scale(radius, radius * FACE_ASPECT);
    context.globalAlpha *= alpha;

    const faceFill = createRadialGradient(
      context,
      -0.18, -0.36, 0.05,
      0, 0, 1.04,
      [
        [0, "#fffbe0"],
        [0.36, "#fff25a"],
        [0.72, "#ffd400"],
        [1, "#f49a00"]
      ],
      "#ffd400"
    );
    context.beginPath();
    context.arc(0, 0, 1, 0, TAU);
    context.fillStyle = faceFill;
    context.fill();
    context.lineWidth = 0.05;
    context.strokeStyle = "rgba(236, 140, 0, 0.9)";
    context.stroke();

    // 底部内缘的橙色加深
    context.beginPath();
    context.arc(0, 0, 0.93, Math.PI * 0.18, Math.PI * 0.82);
    context.lineWidth = 0.16;
    context.strokeStyle = "rgba(226, 112, 0, 0.32)";
    context.stroke();

    // 下唇的亮橙高光（先铺，随后被嘴部深色覆盖内侧）
    context.beginPath();
    context.moveTo(-0.66, 0.255);
    context.bezierCurveTo(-0.62, 0.56, -0.42, 0.8, 0, 0.8);
    context.bezierCurveTo(0.42, 0.8, 0.62, 0.56, 0.66, 0.255);
    context.lineWidth = 0.17;
    context.lineCap = "round";
    context.strokeStyle = "rgba(255, 171, 16, 0.95)";
    context.stroke();

    // 大张的嘴：上缘微拱、下缘深 U，内部为琥珀棕
    context.beginPath();
    context.moveTo(-0.66, 0.235);
    context.quadraticCurveTo(0, 0.155, 0.66, 0.235);
    context.bezierCurveTo(0.64, 0.52, 0.42, 0.755, 0, 0.755);
    context.bezierCurveTo(-0.42, 0.755, -0.64, 0.52, -0.66, 0.235);
    context.closePath();
    const mouthFill = createLinearGradient(
      context,
      0, 0.16,
      0, 0.77,
      [
        [0, "#8c4a05"],
        [0.35, "#ab6201"],
        [0.78, "#b26702"],
        [1, "#9a5700"]
      ],
      "#ab6201"
    );
    context.fillStyle = mouthFill;
    context.fill();
    context.lineWidth = 0.045;
    context.strokeStyle = "#743800";
    context.stroke();

    // 上排牙齿：贴着上唇的白色宽带
    context.beginPath();
    context.moveTo(-0.575, 0.278);
    context.quadraticCurveTo(0, 0.168, 0.575, 0.278);
    context.quadraticCurveTo(0.55, 0.375, 0.48, 0.414);
    context.quadraticCurveTo(0, 0.452, -0.48, 0.414);
    context.quadraticCurveTo(-0.55, 0.375, -0.575, 0.278);
    context.closePath();
    context.fillStyle = "#f5f5f6";
    context.fill();
    context.lineWidth = 0.025;
    context.strokeStyle = "rgba(120, 70, 18, 0.5)";
    context.stroke();

    // 牙齿下缘的暖灰阴影
    context.beginPath();
    context.moveTo(-0.46, 0.415);
    context.quadraticCurveTo(0, 0.451, 0.46, 0.415);
    context.lineWidth = 0.035;
    context.strokeStyle = "rgba(160, 132, 108, 0.42)";
    context.stroke();

    // 眉毛：内高外低的斜挑弧
    context.fillStyle = "#7c3d00";
    fillTaperedCurve(context, -0.74, -0.19, -0.61, -0.3, -0.465, -0.335, 0.09);
    fillTaperedCurve(context, 0.74, -0.19, 0.61, -0.3, 0.465, -0.335, 0.09);

    // 笑眼：两端下垂的粗拱
    context.fillStyle = "#8a4700";
    fillTaperedCurve(context, -0.635, 0.045, -0.405, -0.3, -0.175, 0.03, 0.125);
    fillTaperedCurve(context, 0.635, 0.045, 0.405, -0.3, 0.175, 0.03, 0.125);

    drawTear(context, -0.63, 0.1, 0.55);
    drawTear(context, 0.63, 0.1, -0.55);

    context.restore();
  }

  // 中间粗、两端收尖的二次曲线笔画。
  function fillTaperedCurve(context, startX, startY, controlX, controlY, endX, endY, thickness) {
    const steps = 12;
    const left = [];
    const right = [];
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const inverse = 1 - t;
      const x = inverse * inverse * startX + 2 * inverse * t * controlX + t * t * endX;
      const y = inverse * inverse * startY + 2 * inverse * t * controlY + t * t * endY;
      const tangentX = 2 * inverse * (controlX - startX) + 2 * t * (endX - controlX);
      const tangentY = 2 * inverse * (controlY - startY) + 2 * t * (endY - controlY);
      const length = Math.hypot(tangentX, tangentY) || 1;
      const normalX = -tangentY / length;
      const normalY = tangentX / length;
      const halfWidth = thickness / 2 * Math.pow(Math.sin(Math.PI * t), 0.55);
      left.push([x + normalX * halfWidth, y + normalY * halfWidth]);
      right.push([x - normalX * halfWidth, y - normalY * halfWidth]);
    }
    context.beginPath();
    context.moveTo(left[0][0], left[0][1]);
    for (let index = 1; index < left.length; index += 1) {
      context.lineTo(left[index][0], left[index][1]);
    }
    for (let index = right.length - 1; index >= 0; index -= 1) {
      context.lineTo(right[index][0], right[index][1]);
    }
    context.closePath();
    context.fill();
  }

  function drawTear(context, tipX, tipY, angle) {
    context.save();
    context.translate(tipX, tipY);
    context.rotate(angle);
    context.scale(0.44, 0.62);
    context.beginPath();
    context.moveTo(0, 0);
    context.bezierCurveTo(0.05, 0.22, 0.32, 0.4, 0.34, 0.62);
    context.bezierCurveTo(0.35, 0.84, 0.2, 1, 0, 1);
    context.bezierCurveTo(-0.2, 1, -0.35, 0.84, -0.34, 0.62);
    context.bezierCurveTo(-0.32, 0.4, -0.05, 0.22, 0, 0);
    context.closePath();
    const tearFill = createLinearGradient(
      context,
      0, 0,
      0, 1,
      [
        [0, "#d8fbff"],
        [0.42, "#5ad4f6"],
        [1, "#1f9fe0"]
      ],
      "#49c7f2"
    );
    context.fillStyle = tearFill;
    context.fill();
    context.lineWidth = 0.06;
    context.strokeStyle = "rgba(16, 132, 188, 0.85)";
    context.stroke();
    // 左上角白色高光
    context.save();
    context.translate(-0.15, 0.44);
    context.rotate(-0.16);
    context.scale(0.11, 0.2);
    context.beginPath();
    context.arc(0, 0, 1, 0, TAU);
    context.fillStyle = "rgba(255, 255, 255, 0.88)";
    context.fill();
    context.restore();
    context.restore();
  }

  function fogAlphaAt(time, now) {
    return clamp01(1 - (now - time) / FOG_LIFETIME);
  }

  function pushFogSample(entity, x, y, now) {
    entity.samples.push({ x, y, time: now });
    entity.sampleX = x;
    entity.sampleY = y;
  }

  function touchesFog(samples, target) {
    const reach = target.radius + FOG_HALF_WIDTH;
    if (samples.length === 1) {
      return Math.hypot(target.x - samples[0].x, target.y - samples[0].y) <= reach;
    }
    for (let index = 1; index < samples.length; index += 1) {
      const from = samples[index - 1];
      const to = samples[index];
      if (firstSegmentCircleContact(
        from.x, from.y, to.x, to.y, target.x, target.y, reach
      ) !== null) return true;
    }
    return false;
  }

  // 一枚洋葱丝携带自己的整条紫雾。丝本身无伤害、无碰撞体积；雾按
  // 每个采样点各自的 1.6 秒寿命衰减，触雾的敌人各结算一次表情控制。
  function createOnionSliver({ x, y, directionX, directionY, ownerInstanceId, now }) {
    return {
      kind: "onion-sliver",
      // 紫雾贴地铺开：画在本体下方，避免半透明紫雾把表情/血量染色。
      drawLayer: "background",
      replayDamage: 0,
      life: SLIVER_LIFE,
      radius: SLIVER_RADIUS,
      x,
      y,
      vx: directionX * SLIVER_SPEED,
      vy: directionY * SLIVER_SPEED,
      directionX,
      directionY,
      sliverActive: true,
      sliverAngle: Math.atan2(directionY, directionX),
      samples: [{ x, y, time: now }],
      sampleX: x,
      sampleY: y,
      touchingEnemyIds: new Set(),
      contactScratch: new Set(),
      touchEffect: createOnionEmojiEffect(ownerInstanceId),
      update({ entity, game, services }, dt) {
        const elapsed = Math.max(0, dt);
        if (entity.sliverActive) {
          entity.x += entity.vx * elapsed;
          entity.y += entity.vy * elapsed;
          const limit = SLIVER_EDGE_PADDING;
          const arena = resolveArenaGeometry(game);
          const stopped = !arena.contains(entity.x, entity.y, limit);
          if (stopped) { Object.assign(entity, arena.clampPoint(entity.x, entity.y, limit)); entity.sliverActive = false; }
          const sampleDx = entity.x - entity.sampleX;
          const sampleDy = entity.y - entity.sampleY;
          if (stopped || sampleDx * sampleDx + sampleDy * sampleDy >=
              SLIVER_SAMPLE_SPACING * SLIVER_SAMPLE_SPACING) {
            pushFogSample(entity, entity.x, entity.y, game.time);
          }
        }
        const cutoff = game.time - FOG_LIFETIME;
        let expired = 0;
        while (expired < entity.samples.length && entity.samples[expired].time <= cutoff) {
          expired += 1;
        }
        if (expired > 0) entity.samples.splice(0, expired);
        if (entity.samples.length > 0) {
          const previouslyTouching = entity.touchingEnemyIds;
          const touchingNow = entity.contactScratch;
          touchingNow.clear();
          services.forEachEnemy((target) => {
            if (!touchesFog(entity.samples, target)) return;
            touchingNow.add(target.instanceId);
            // 同一次持续接触只结算一次；离开后再碰到雾会再次触发，
            // 由 applyEffect 刷新持续时间（渐隐中则转为渐显）。
            if (previouslyTouching.has(target.instanceId)) return;
            if (target.effects instanceof Map) {
              if (services.applyEffect(target, entity.touchEffect)) {
                services.spawnParticleBurst({
                  kind: "onion-control-puff",
                  x: target.x,
                  y: target.y,
                  count: 6,
                  colors: ["#efd9ff", "#c78aec", "#8f4fbd"],
                  minDiameter: 1,
                  maxDiameter: 2.6,
                  minSpeed: 10,
                  maxSpeed: 34,
                  initialRadius: target.radius * 0.45,
                  drag: 3.2,
                  life: 0.4
                });
              }
            }
          });
          entity.contactScratch = previouslyTouching;
          entity.touchingEnemyIds = touchingNow;
        }
        if (!entity.sliverActive && entity.samples.length === 0) {
          entity.entityActive = false;
          entity.life = 0;
        }
      },
      draw({ entity, game }, context) {
        drawOnionFog(entity, game.time, context);
        if (entity.sliverActive) drawOnionSliver(entity, context);
      }
    };
  }

  function drawFogPuff(context, x, y, diameter, alpha) {
    const radius = diameter / 2;
    if (typeof context.createRadialGradient === "function") {
      const gradient = context.createRadialGradient(
        x, y, radius * 0.05,
        x, y, radius
      );
      gradient.addColorStop(0, `rgba(226, 190, 247, ${alpha})`);
      gradient.addColorStop(0.5, `rgba(180, 118, 225, ${alpha * 0.55})`);
      gradient.addColorStop(1, "rgba(162, 88, 214, 0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, radius, 0, TAU);
      context.fill();
      return;
    }
    context.beginPath();
    context.arc(x, y, radius * 0.7, 0, TAU);
    context.fillStyle = `rgba(170, 110, 215, ${alpha})`;
    context.fill();
  }

  function drawOnionFog(entity, now, context) {
    const samples = entity.samples;
    if (samples.length < 2) return;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const pathLength = Math.hypot(dx, dy);
    if (pathLength <= EPSILON) return;
    const normalX = -dy / pathLength;
    const normalY = dx / pathLength;
    const headAge = fogAlphaAt(last.time, now);
    if (headAge <= 0.01) return;
    const baseAlpha = Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1;
    const count = Math.min(
      FOG_PUFF_MAX_COUNT,
      Math.max(FOG_PUFF_MIN_COUNT, Math.ceil(pathLength / FOG_PUFF_SPACING))
    );
    context.save();
    context.globalAlpha = baseAlpha;
    for (let index = 0; index < count; index += 1) {
      const t = count === 1 ? 1 : index / (count - 1);
      const sampleIndex = Math.min(
        samples.length - 1,
        Math.round(t * (samples.length - 1))
      );
      const sample = samples[sampleIndex];
      const age = fogAlphaAt(sample.time, now);
      if (age <= 0.02) continue;
      const seed = index * 19.7 + sample.time * 13.1;
      const side = hash01(seed) < 0.5 ? -1 : 1;
      const spread = (hash01(seed + 2.4) - 0.5) * 4 +
        (1 - age) * (3 + hash01(seed + 6.8) * 5) * side;
      const diameter = 30 + (1 - age) * 10 + hash01(seed + 4.2) * 8;
      const alpha = FOG_PUFF_ALPHA * age * (0.75 + hash01(seed + 9.5) * 0.5);
      drawFogPuff(
        context,
        sample.x + normalX * spread,
        sample.y + normalY * spread,
        diameter,
        alpha
      );
    }
    // 丝尖的释放口：两团贴着丝、向外翻的浓烟，中间再垫一团把云连成整片。
    const directionX = dx / pathLength;
    const directionY = dy / pathLength;
    const centralDiameter = 36 + (1 - headAge) * 8;
    drawFogPuff(
      context,
      last.x - directionX * 6,
      last.y - directionY * 6,
      centralDiameter,
      FOG_PUFF_ALPHA * headAge
    );
    for (let index = 0; index < 2; index += 1) {
      const side = index === 0 ? 1 : -1;
      const seed = index * 13.1 + last.time * 7.7;
      const behind = 4 + hash01(seed + 1.2) * 5;
      const spread = 4 + (1 - headAge) * 9;
      const diameter = 34 + hash01(seed + 3.8) * 10 + (1 - headAge) * 8;
      const alpha = FOG_PUFF_ALPHA * headAge * (0.9 + hash01(seed + 9.1) * 0.4);
      drawFogPuff(
        context,
        last.x + normalX * side * spread - directionX * behind,
        last.y + normalY * side * spread - directionY * behind,
        diameter,
        alpha
      );
    }
    context.restore();
  }

  function drawOnionSliver(entity, context) {
    const sway = Math.sin(entity.age * 8) * 0.12;
    const half = SLIVER_LENGTH / 2;
    context.save();
    context.translate(entity.x, entity.y);
    context.rotate(entity.sliverAngle + sway);
    context.beginPath();
    context.moveTo(-half, 0);
    context.quadraticCurveTo(0, -SLIVER_ARC, half, 0);
    context.quadraticCurveTo(0, -SLIVER_ARC * 0.18, -half, 0);
    context.closePath();
    context.fillStyle = createLinearGradient(
      context,
      0, -SLIVER_ARC,
      0, 0,
      [
        [0, "#f6e8fb"],
        [0.42, "#d3a1e5"],
        [0.72, "#b271cb"],
        [1, "#ede0f5"]
      ],
      "#d9aee8"
    );
    context.fill();
    context.lineWidth = 0.6;
    context.strokeStyle = "#4f2566";
    context.stroke();
    context.beginPath();
    context.moveTo(-half * 0.72, -SLIVER_ARC * 0.32);
    context.quadraticCurveTo(0, -SLIVER_ARC * 1.08, half * 0.7, -SLIVER_ARC * 0.26);
    context.lineWidth = 0.45;
    context.strokeStyle = "rgba(255, 255, 255, 0.62)";
    context.stroke();
    context.restore();
  }

  // 本体：红洋葱横截面。淡紫白鳞肉占主体，紫色只做细层环与薄外皮；
  // 外缘留一圈浅色高光，避免深色包边让整颗球看起来比同直径纯色球小。
  function drawOnionBody(ball, context) {
    const radius = ball.radius;
    context.save();
    context.translate(ball.x, ball.y);

    context.beginPath();
    context.arc(0, 0, radius, 0, TAU);
    context.fillStyle = createRadialGradient(
      context,
      -radius * 0.2, -radius * 0.3, radius * 0.1,
      0, 0, radius,
      [
        [0, "#fffaff"],
        [0.55, "#fbf0f9"],
        [0.84, "#eedbea"],
        [0.96, "#d8b5d2"],
        [1, "#bd86b6"]
      ],
      "#f2e2f0"
    );
    context.fill();

    // 细紫层环：把淡色鳞肉分层，但不要压暗中心
    const rings = [
      [0.8, 0.9, "rgba(156, 72, 138, 0.55)"],
      [0.61, 0.8, "rgba(176, 92, 158, 0.5)"],
      [0.42, 0.75, "rgba(150, 66, 132, 0.58)"],
      [0.24, 0.65, "rgba(172, 86, 154, 0.52)"],
      [0.1, 0.55, "rgba(140, 58, 122, 0.6)"]
    ];
    for (const [ratio, width, color] of rings) {
      context.beginPath();
      context.arc(0, 0, radius * ratio, 0, TAU);
      context.lineWidth = width;
      context.strokeStyle = color;
      context.stroke();
    }

    // 放射状细胞壁：极淡的细线，只把层环轻轻切开
    for (let index = 0; index < 10; index += 1) {
      const angle = index * TAU / 10 + 0.18;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      context.beginPath();
      context.moveTo(cosine * radius * 0.12, sine * radius * 0.12);
      context.quadraticCurveTo(
        Math.cos(angle + 0.06) * radius * 0.5,
        Math.sin(angle + 0.06) * radius * 0.5,
        cosine * radius * 0.88,
        sine * radius * 0.88
      );
      context.lineWidth = 0.4;
      context.strokeStyle = "rgba(150, 80, 140, 0.24)";
      context.stroke();
    }

    // 外缘浅色高光：把可见轮廓往外扩，抵消深色包边的收缩感
    context.beginPath();
    context.arc(0, 0, radius * 0.915, 0, TAU);
    context.lineWidth = 1.4;
    context.strokeStyle = "rgba(255, 246, 255, 0.6)";
    context.stroke();

    // 中心嫩芯
    context.beginPath();
    context.arc(0, 0, radius * 0.1, 0, TAU);
    context.fillStyle = "#fff4fd";
    context.lineWidth = 0.7;
    context.strokeStyle = "rgba(160, 80, 145, 0.6)";
    context.fill();
    context.stroke();

    // 薄外皮与高光
    context.beginPath();
    context.arc(0, 0, radius * 0.975, 0, TAU);
    context.lineWidth = 1;
    context.strokeStyle = "#8a3f7c";
    context.stroke();
    context.beginPath();
    context.arc(0, 0, radius * 0.8, Math.PI * 1.12, Math.PI * 1.46);
    context.lineWidth = 2.2;
    context.strokeStyle = "rgba(255, 255, 255, 0.38)";
    context.stroke();

    context.beginPath();
    context.arc(0, 0, radius, 0, TAU);
    context.lineWidth = 0.8;
    context.strokeStyle = "#4a1d42";
    context.stroke();
    context.restore();
  }

  function aimDirection(ball, target) {
    if (target) {
      const dx = target.x - ball.x;
      const dy = target.y - ball.y;
      const length = Math.hypot(dx, dy);
      if (length > EPSILON) return { x: dx / length, y: dy / length };
    }
    const vx = Number.isFinite(ball.storedVx) ? ball.storedVx : 0;
    const vy = Number.isFinite(ball.storedVy) ? ball.storedVy : 0;
    const length = Math.hypot(vx, vy);
    if (length > EPSILON) return { x: vx / length, y: vy / length };
    return { x: 1, y: 0 };
  }

  const onionDefinition = {
    id: "onion",
    name: "\u6d0b\u8471",
    englishName: "Onion",
    color: "#a34d94",
    description: "\u78b0\u649e5\u70b9\u4f24\u5bb3 / \u6bcf4.8\u79d2\u5c04\u51fa\u6d0b\u8471\u4e1d / "
      + "\u7d2b\u96fe\u5bbd20\u6301\u7eed1.6\u79d2 / \u89e6\u96fe\u8005\u53d7\u63a7\u65e0\u6cd5\u653b\u51fb2.4\u79d2 / "
      + "\u6bcf\u593110\u8840\u5341\u5b57\u56db\u5411\u53d1\u5c04\u6d0b\u8471\u4e1d",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: FIRE_INTERVAL,
    createBehavior(services) {
      let timer = 0;
      let damageRemainder = 0;
      let hpBeforeDamage = null;

      function launchOnionVolley(ball, now) {
        const offset = Math.random() * TAU;
        for (let index = 0; index < VOLLEY_COUNT; index += 1) {
          const angle = offset + index * TAU / VOLLEY_COUNT;
          services.spawnProjectile(createOnionSliver({
            x: ball.x,
            y: ball.y,
            directionX: Math.cos(angle),
            directionY: Math.sin(angle),
            ownerInstanceId: ball.instanceId,
            now
          }));
        }
      }

      return {
        onAttackBorrowStart(context) {
          timer = FIRE_INTERVAL;
          this.afterUpdateStep(context);
        },
        update(_context, dt) {
          timer = Math.min(FIRE_INTERVAL, timer + Math.max(0, dt));
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, FIRE_INTERVAL - timer);
        },
        afterUpdateStep(context) {
          if (timer + EPSILON < FIRE_INTERVAL) return;
          timer = 0;
          const ball = context.ball;
          const target = services.getOpponent();
          const direction = aimDirection(ball, target);
          services.spawnProjectile(createOnionSliver({
            x: ball.x,
            y: ball.y,
            directionX: direction.x,
            directionY: direction.y,
            ownerInstanceId: ball.instanceId,
            now: context.game.time
          }));
        },
        onBeforeDamage({ ball }, event) {
          hpBeforeDamage = ball.hp;
          return event;
        },
        onDamaged({ ball, game }, event) {
          if (!Number.isFinite(event.amount) || event.amount <= 0) return;
          const lost = hpBeforeDamage === null
            ? event.amount
            : Math.min(event.amount, Math.max(0, hpBeforeDamage));
          hpBeforeDamage = null;
          if (lost <= 0) return;
          damageRemainder += lost;
          while (damageRemainder + EPSILON >= VOLLEY_TRIGGER_HP) {
            damageRemainder -= VOLLEY_TRIGGER_HP;
            launchOnionVolley(ball, game.time);
          }
        },
        onCollision(context, target) {
          if (context.blockedAtContact) return;
          context.services.dealDamage(target, CONTACT_DAMAGE);
        },
        drawBody(context, canvasContext) {
          drawOnionBody(context.ball, canvasContext);
          return true;
        }
      };
    }
  };

  registerBall(onionDefinition);

  return {
    onionDefinition,
    createOnionSliver,
    createOnionEmojiEffect,
    drawOnionEmoji,
    drawOnionEmojiTexture,
    onionRules: Object.freeze({
      contactDamage: CONTACT_DAMAGE,
      fireInterval: FIRE_INTERVAL,
      sliverSpeed: SLIVER_SPEED,
      sliverRadius: SLIVER_RADIUS,
      sliverLength: SLIVER_LENGTH,
      sliverArc: SLIVER_ARC,
      sliverSampleSpacing: SLIVER_SAMPLE_SPACING,
      fogWidth: FOG_WIDTH,
      fogLifetime: FOG_LIFETIME,
      emojiFadeIn: EMOJI_FADE_IN,
      emojiHold: EMOJI_HOLD,
      emojiFadeOut: EMOJI_FADE_OUT,
      emojiDuration: EMOJI_DURATION,
      emojiRadiusScale: EMOJI_RADIUS_SCALE,
      volleyTriggerHp: VOLLEY_TRIGGER_HP,
      volleyCount: VOLLEY_COUNT
    })
  };
});
