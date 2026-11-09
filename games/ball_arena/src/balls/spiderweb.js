(function initializeSpiderweb(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSpiderwebPlugin({ resolveArenaGeometry, registerBall }) {
  const DAMAGE_PER_CROSSING = 1;
  const SILK_WIDTH = 0.9;
  const SILK_HALF_WIDTH = SILK_WIDTH / 2;
  const SILK_UNDERLAY_WIDTH = 2.2;
  const SILK_SIDE_STRAND_OFFSET = 0.28;
  const SILK_SIDE_STRAND_WIDTH = 0.35;
  const SILK_KNOT_COUNT = 5;
  const SILK_ALPHA_START = 0.82;
  const SILK_ALPHA_FLOOR = 0.5;
  const SILK_FADE_DELAY = 2;
  const SILK_FADE_DURATION = 6;
  const EPSILON = 1e-9;
  const EPSILON_SQUARED = EPSILON * EPSILON;

  function crossProduct(ax, ay, bx, by) {
    return ax * by - ay * bx;
  }

  function pointToSegmentDistanceSquared(pointX, pointY, startX, startY, endX, endY) {
    const segmentX = endX - startX;
    const segmentY = endY - startY;
    const lengthSquared = segmentX * segmentX + segmentY * segmentY;
    if (lengthSquared <= EPSILON_SQUARED) {
      const deltaX = pointX - startX;
      const deltaY = pointY - startY;
      return deltaX * deltaX + deltaY * deltaY;
    }

    const progress = Math.max(0, Math.min(1, (
      (pointX - startX) * segmentX + (pointY - startY) * segmentY
    ) / lengthSquared));
    const deltaX = pointX - (startX + segmentX * progress);
    const deltaY = pointY - (startY + segmentY * progress);
    return deltaX * deltaX + deltaY * deltaY;
  }

  function pointLiesOnSegment(pointX, pointY, startX, startY, endX, endY) {
    return (
      pointX >= Math.min(startX, endX) - EPSILON &&
      pointX <= Math.max(startX, endX) + EPSILON &&
      pointY >= Math.min(startY, endY) - EPSILON &&
      pointY <= Math.max(startY, endY) + EPSILON
    );
  }

  function segmentsIntersect(aX, aY, bX, bY, cX, cY, dX, dY) {
    const abX = bX - aX;
    const abY = bY - aY;
    const cdX = dX - cX;
    const cdY = dY - cY;
    const cSide = crossProduct(abX, abY, cX - aX, cY - aY);
    const dSide = crossProduct(abX, abY, dX - aX, dY - aY);
    const aSide = crossProduct(cdX, cdY, aX - cX, aY - cY);
    const bSide = crossProduct(cdX, cdY, bX - cX, bY - cY);

    if (
      ((cSide > EPSILON && dSide < -EPSILON) ||
        (cSide < -EPSILON && dSide > EPSILON)) &&
      ((aSide > EPSILON && bSide < -EPSILON) ||
        (aSide < -EPSILON && bSide > EPSILON))
    ) return true;

    return (
      (Math.abs(cSide) <= EPSILON && pointLiesOnSegment(cX, cY, aX, aY, bX, bY)) ||
      (Math.abs(dSide) <= EPSILON && pointLiesOnSegment(dX, dY, aX, aY, bX, bY)) ||
      (Math.abs(aSide) <= EPSILON && pointLiesOnSegment(aX, aY, cX, cY, dX, dY)) ||
      (Math.abs(bSide) <= EPSILON && pointLiesOnSegment(bX, bY, cX, cY, dX, dY))
    );
  }

  function segmentDistanceSquared(aX, aY, bX, bY, cX, cY, dX, dY) {
    if (segmentsIntersect(aX, aY, bX, bY, cX, cY, dX, dY)) return 0;
    return Math.min(
      pointToSegmentDistanceSquared(aX, aY, cX, cY, dX, dY),
      pointToSegmentDistanceSquared(bX, bY, cX, cY, dX, dY),
      pointToSegmentDistanceSquared(cX, cY, aX, aY, bX, bY),
      pointToSegmentDistanceSquared(dX, dY, aX, aY, bX, bY)
    );
  }

  function pointLiesInTriangle(pointX, pointY, aX, aY, bX, bY, cX, cY) {
    const area = crossProduct(bX - aX, bY - aY, cX - aX, cY - aY);
    if (Math.abs(area) <= EPSILON) return false;

    const sideAB = crossProduct(bX - aX, bY - aY, pointX - aX, pointY - aY);
    const sideBC = crossProduct(cX - bX, cY - bY, pointX - bX, pointY - bY);
    const sideCA = crossProduct(aX - cX, aY - cY, pointX - cX, pointY - cY);
    const hasNegative = sideAB < -EPSILON || sideBC < -EPSILON || sideCA < -EPSILON;
    const hasPositive = sideAB > EPSILON || sideBC > EPSILON || sideCA > EPSILON;
    return !(hasNegative && hasPositive);
  }

  function sweepTouchesSilk(target, silk, ball, previousBallX, previousBallY, touchRadius) {
    const radiusSquared = touchRadius * touchRadius;
    const minimumSilkX = Math.min(silk.anchorX, previousBallX, ball.x) - touchRadius;
    const maximumSilkX = Math.max(silk.anchorX, previousBallX, ball.x) + touchRadius;
    const minimumSilkY = Math.min(silk.anchorY, previousBallY, ball.y) - touchRadius;
    const maximumSilkY = Math.max(silk.anchorY, previousBallY, ball.y) + touchRadius;
    if (
      Math.max(target.prevX, target.x) < minimumSilkX ||
      Math.min(target.prevX, target.x) > maximumSilkX ||
      Math.max(target.prevY, target.y) < minimumSilkY ||
      Math.min(target.prevY, target.y) > maximumSilkY
    ) return false;

    if (
      pointLiesInTriangle(
        target.prevX,
        target.prevY,
        silk.anchorX,
        silk.anchorY,
        previousBallX,
        previousBallY,
        ball.x,
        ball.y
      ) ||
      pointLiesInTriangle(
        target.x,
        target.y,
        silk.anchorX,
        silk.anchorY,
        previousBallX,
        previousBallY,
        ball.x,
        ball.y
      )
    ) return true;

    return (
      segmentDistanceSquared(
        target.prevX,
        target.prevY,
        target.x,
        target.y,
        silk.anchorX,
        silk.anchorY,
        previousBallX,
        previousBallY
      ) <= radiusSquared ||
      segmentDistanceSquared(
        target.prevX,
        target.prevY,
        target.x,
        target.y,
        previousBallX,
        previousBallY,
        ball.x,
        ball.y
      ) <= radiusSquared ||
      segmentDistanceSquared(
        target.prevX,
        target.prevY,
        target.x,
        target.y,
        ball.x,
        ball.y,
        silk.anchorX,
        silk.anchorY
      ) <= radiusSquared
    );
  }

  function currentlyTouchesSilk(target, silk, ball, touchRadius) {
    return pointToSegmentDistanceSquared(
      target.x,
      target.y,
      silk.anchorX,
      silk.anchorY,
      ball.x,
      ball.y
    ) <= touchRadius * touchRadius;
  }

  function silkFadeAlpha(silk) {
    const age = Number.isFinite(silk.age) ? silk.age : 0;
    const progress = Math.max(0, Math.min(1, (
      age - SILK_FADE_DELAY
    ) / SILK_FADE_DURATION));
    return SILK_ALPHA_START + (SILK_ALPHA_FLOOR - SILK_ALPHA_START) * progress;
  }

  // One reusable rendering resource, with no entity references retained between
  // frames. Source-over blending preserves the order of crossing strands.
  let silkGpu;
  const SILK_VERTEX_SHADER = `#version 300 es
    precision highp float;
    in vec2 corner;
    in vec4 segment;
    in vec4 appearance;
    in float age;
    uniform float arenaSize;
    uniform float pixelScale;
    out vec2 point;
    flat out float strandLength;
    flat out vec4 strandAppearance;
    flat out float strandAge;
    void main() {
      vec2 delta = segment.zw - segment.xy;
      float length = max(length(delta), 0.000001);
      vec2 direction = delta / length;
      float padding = 1.1 + 1.0 / pixelScale;
      point = vec2(mix(-padding, length + padding, corner.x), corner.y * padding);
      vec2 position = segment.xy + direction * point.x + vec2(-direction.y, direction.x) * point.y;
      gl_Position = vec4(position.x / arenaSize * 2.0 - 1.0, 1.0 - position.y / arenaSize * 2.0, 0, 1);
      strandLength = length;
      strandAppearance = appearance;
      strandAge = age;
    }`;
  const SILK_FRAGMENT_SHADER = `#version 300 es
    precision highp float;
    in vec2 point;
    flat in float strandLength;
    flat in vec4 strandAppearance;
    flat in float strandAge;
    uniform float pixelScale;
    uniform float baseAlpha;
    out vec4 outputColor;
    float coverage(float distance) {
      return clamp(0.5 - distance * pixelScale, 0.0, 1.0);
    }
    float capsule(vec2 p, float extent, float radius) {
      return coverage(length(vec2(p.x - clamp(p.x, 0.0, extent), p.y)) - radius);
    }
    void over(inout vec4 result, vec3 color, float alpha) {
      result = vec4(color * alpha, alpha) + result * (1.0 - alpha);
    }
    void main() {
      float fade = strandAppearance.a * baseAlpha;
      vec4 result = vec4(0);
      over(result, vec3(9,13,20)/255.0, fade * 0.6 * 0.55 * capsule(point, strandLength, 1.1));
      over(result, strandAppearance.rgb, fade * 0.32 * capsule(point-vec2(0,-0.28), strandLength, 0.175));
      over(result, strandAppearance.rgb, fade * 0.32 * capsule(point-vec2(0,0.28), strandLength, 0.175));
      over(result, strandAppearance.rgb, fade * capsule(point, strandLength, 0.45));
      for (int i=0; i<5; i++) {
        float x = strandLength * float(i+1) / 6.0;
        float cross = capsule(vec2(point.y + 0.45, point.x - x), 0.9, 0.15);
        over(result, vec3(201,216,232)/255.0, fade * 0.5 * cross);
      }
      for (int i=0; i<5; i++) {
        float x = strandLength * float(i+1) / 6.0;
        float pulse = 0.5 + 0.5 * sin(strandAge * 2.4 - float(i) * 1.15);
        float dot = coverage(length(point - vec2(x,0)) - (0.32 + pulse * 0.12));
        over(result, vec3(38,56,78)/255.0, fade * (0.45 + pulse * 0.25) * dot);
      }
      outputColor = result;
    }`;

  function createSilkGpu() {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", {
      alpha: true, antialias: false, depth: false, stencil: false,
      powerPreference: "high-performance", premultipliedAlpha: true
    });
    if (!gl) return null;
    const program = gl.createProgram();
    const shaders = [];
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, SILK_VERTEX_SHADER], [gl.FRAGMENT_SHADER, SILK_FRAGMENT_SHADER]]) {
        const shader = gl.createShader(type);
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error("Spiderweb shader: " + gl.getShaderInfoLog(shader));
        }
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error("Spiderweb shader link: " + gl.getProgramInfoLog(program));
      }
    } catch (error) {
      gl.deleteProgram(program);
      throw error;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
    const vertexArray = gl.createVertexArray();
    gl.bindVertexArray(vertexArray);
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,-1,1,-1,0,1,0,1,1,-1,1,1]), gl.STATIC_DRAW);
    const cornerLocation = gl.getAttribLocation(program, "corner");
    gl.enableVertexAttribArray(cornerLocation);
    gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 0, 0);
    const instances = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    for (const [name, components, offset] of [["segment",4,0],["appearance",4,4],["age",1,8]]) {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, components, gl.FLOAT, false, 9 * 4, offset * 4);
      gl.vertexAttribDivisor(location, 1);
    }
    const uniforms = {};
    for (const name of ["arenaSize", "pixelScale", "baseAlpha"]) uniforms[name] = gl.getUniformLocation(program, name);
    const resource = { canvas, gl, program, vertexArray, instances, uniforms, data: new Float32Array(9 * 64) };
    canvas.addEventListener("webglcontextlost", event => event.preventDefault());
    canvas.addEventListener("webglcontextrestored", () => { silkGpu = undefined; });
    return resource;
  }

  function drawSilkBatch({ game, entities }, context) {
    const matrix = typeof context.getTransform === "function" ? context.getTransform() : null;
    const scale = matrix && matrix.a;
    const canDrawGpu = typeof document !== "undefined" && Number.isFinite(scale) && scale > 0 &&
      matrix.b === 0 && matrix.c === 0 && matrix.d === scale &&
      context.globalCompositeOperation === "source-over" && context.filter === "none" && context.shadowBlur === 0 &&
      entities.every(entity => entity.owner && /^#[0-9a-f]{6}$/i.test(entity.color || "#ffffff"));
    if (!canDrawGpu) {
      for (const entity of entities) drawSilk(context, entity);
      return;
    }
    if (silkGpu === undefined) silkGpu = createSilkGpu();
    if (!silkGpu || silkGpu.gl.isContextLost()) {
      for (const entity of entities) drawSilk(context, entity);
      return;
    }
    const resource = silkGpu;
    const { gl, canvas, program, uniforms } = resource;
    if (resource.data.length < entities.length * 9) {
      resource.data = new Float32Array(2 ** Math.ceil(Math.log2(entities.length * 9)));
    }
    let count = 0;
    for (const entity of entities) {
      const owner = entity.owner;
      if (Math.hypot(owner.x - entity.anchorX, owner.y - entity.anchorY) <= EPSILON) continue;
      const color = Number.parseInt((entity.color || "#ffffff").slice(1), 16);
      const offset = count * 9;
      resource.data[offset] = entity.anchorX;
      resource.data[offset + 1] = entity.anchorY;
      resource.data[offset + 2] = owner.x;
      resource.data[offset + 3] = owner.y;
      resource.data[offset + 4] = (color >> 16) / 255;
      resource.data[offset + 5] = ((color >> 8) & 255) / 255;
      resource.data[offset + 6] = (color & 255) / 255;
      resource.data[offset + 7] = silkFadeAlpha(entity);
      resource.data[offset + 8] = Number.isFinite(entity.age) ? entity.age : 0;
      count += 1;
    }
    const pixels = Math.round(game.arenaSize * scale);
    if (canvas.width !== pixels || canvas.height !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
    }
    gl.viewport(0, 0, pixels, pixels);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform1f(uniforms.arenaSize, game.arenaSize);
    gl.uniform1f(uniforms.pixelScale, pixels / game.arenaSize);
    gl.uniform1f(uniforms.baseAlpha, context.globalAlpha);
    gl.bindVertexArray(resource.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, resource.instances);
    gl.bufferData(gl.ARRAY_BUFFER, resource.data.subarray(0, count * 9), gl.STREAM_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    context.save();
    context.globalAlpha = 1;
    context.drawImage(canvas, 0, 0, game.arenaSize, game.arenaSize);
    context.restore();
  }

  function drawSilk(canvasContext, silk) {
    const ball = silk.owner;
    if (!ball) return;
    const color = silk.color || "#ffffff";
    const fadeAlpha = silkFadeAlpha(silk);
    const baseAlpha = canvasContext.globalAlpha;
    const deltaX = ball.x - silk.anchorX;
    const deltaY = ball.y - silk.anchorY;
    const length = Math.hypot(deltaX, deltaY);
    if (length <= EPSILON) return;
    canvasContext.save();
    canvasContext.lineCap = "round";

    const normalX = -deltaY / length;
    const normalY = deltaX / length;
    canvasContext.globalAlpha = baseAlpha * fadeAlpha * 0.6;
    canvasContext.strokeStyle = "rgba(9, 13, 20, 0.55)";
    canvasContext.lineWidth = SILK_UNDERLAY_WIDTH;
    canvasContext.beginPath();
    canvasContext.moveTo(silk.anchorX, silk.anchorY);
    canvasContext.lineTo(ball.x, ball.y);
    canvasContext.stroke();

    canvasContext.globalAlpha = baseAlpha * fadeAlpha * 0.32;
    canvasContext.strokeStyle = color;
    canvasContext.lineWidth = SILK_SIDE_STRAND_WIDTH;
    canvasContext.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      const offset = side * SILK_SIDE_STRAND_OFFSET;
      canvasContext.moveTo(
        silk.anchorX + normalX * offset,
        silk.anchorY + normalY * offset
      );
      canvasContext.lineTo(
        ball.x + normalX * offset,
        ball.y + normalY * offset
      );
    }
    canvasContext.stroke();

    canvasContext.globalAlpha = baseAlpha * fadeAlpha;
    canvasContext.strokeStyle = color;
    canvasContext.lineWidth = SILK_WIDTH;
    canvasContext.beginPath();
    canvasContext.moveTo(silk.anchorX, silk.anchorY);
    canvasContext.lineTo(ball.x, ball.y);
    canvasContext.stroke();
    canvasContext.globalAlpha = baseAlpha * fadeAlpha * 0.5;
    canvasContext.strokeStyle = "#c9d8e8";
    canvasContext.lineWidth = 0.3;
    canvasContext.beginPath();
    for (let index = 0; index < SILK_KNOT_COUNT; index += 1) {
      const progress = (index + 1) / (SILK_KNOT_COUNT + 1);
      const knotX = silk.anchorX + deltaX * progress;
      const knotY = silk.anchorY + deltaY * progress;
      canvasContext.moveTo(
        knotX - normalX * SILK_HALF_WIDTH,
        knotY - normalY * SILK_HALF_WIDTH
      );
      canvasContext.lineTo(
        knotX + normalX * SILK_HALF_WIDTH,
        knotY + normalY * SILK_HALF_WIDTH
      );
    }
    canvasContext.stroke();

    const age = Number.isFinite(silk.age) ? silk.age : 0;
    canvasContext.fillStyle = "#26384e";
    for (let index = 0; index < SILK_KNOT_COUNT; index += 1) {
      const progress = (index + 1) / (SILK_KNOT_COUNT + 1);
      const pulse = 0.5 + 0.5 * Math.sin(age * 2.4 - index * 1.15);
      canvasContext.globalAlpha = baseAlpha * fadeAlpha * (0.45 + pulse * 0.25);
      const knotX = silk.anchorX + deltaX * progress;
      const knotY = silk.anchorY + deltaY * progress;
      canvasContext.beginPath();
      canvasContext.arc(knotX, knotY, 0.32 + pulse * 0.12, 0, Math.PI * 2);
      canvasContext.fill();
    }
    canvasContext.restore();
  }

  function spawnSilkSpinBurst(services, ball, x, y) {
    services.spawnParticleBurst({
      kind: "spiderweb-spin",
      x,
      y,
      count: 14,
      minDiameter: 1,
      maxDiameter: 3,
      colors: [ball.color || "#ffffff", "#dce6f1", "#98a7b8"],
      life: 0.42,
      minSpeed: 16,
      maxSpeed: 56,
      drag: 4,
      gravityY: 12,
      initialRadius: 2,
      properties: {
        opacity: {
          overLife: [
            { at: 0, value: 0.85 },
            { at: 0.3, value: 0.65 },
            { at: 1, value: 0 }
          ]
        },
        sizeScale: {
          overLife: [
            { at: 0, value: 0.5 },
            { at: 0.35, value: 1 },
            { at: 1, value: 0.3 }
          ]
        }
      }
    });
  }

  function closestPointOnSilk(silk, ball, x, y) {
    const deltaX = ball.x - silk.anchorX;
    const deltaY = ball.y - silk.anchorY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    if (lengthSquared <= EPSILON_SQUARED) {
      return { x: silk.anchorX, y: silk.anchorY };
    }
    const progress = Math.max(0, Math.min(1, (
      (x - silk.anchorX) * deltaX + (y - silk.anchorY) * deltaY
    ) / lengthSquared));
    return {
      x: silk.anchorX + deltaX * progress,
      y: silk.anchorY + deltaY * progress
    };
  }

  function spawnSilkContactBurst(entityServices, silk, ball, target) {
    const contact = closestPointOnSilk(silk, ball, target.x, target.y);
    entityServices.spawnParticleBurst({
      kind: "spiderweb-pluck",
      x: contact.x,
      y: contact.y,
      count: 8,
      minDiameter: 0.7,
      maxDiameter: 2.2,
      colors: [silk.color || "#ffffff", "#dce6f1", target.color || "#ffffff"],
      life: 0.26,
      minSpeed: 16,
      maxSpeed: 54,
      drag: 5,
      initialRadius: 1,
      properties: {
        opacity: {
          overLife: [
            { at: 0, value: 0.95 },
            { at: 0.45, value: 0.7 },
            { at: 1, value: 0 }
          ]
        },
        sizeScale: {
          overLife: [
            { at: 0, value: 0.6 },
            { at: 0.4, value: 1 },
            { at: 1, value: 0.25 }
          ]
        }
      }
    });
  }

  const spiderwebDefinition = {
    id: "spiderweb",
    name: "蛛网",
    englishName: "Spiderweb",
    color: "#ffffff",
    description: "撞边织网 / 触碰蛛丝 -1",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior(services) {
      return {
        onWallBounce(context) {
          const { ball, game } = context;
          const wall = context.wallContacts && context.wallContacts[0];
          const anchorX = wall ? wall.x : context.bouncedX
            ? (ball.x <= ball.radius + EPSILON ? 0 : game.arenaSize)
            : ball.x;
          const anchorY = wall ? wall.y : context.bouncedY
            ? (ball.y <= ball.radius + EPSILON ? 0 : game.arenaSize)
            : ball.y;
          const anchor = { x: anchorX, y: anchorY };
          services.spawnCombatEntity({
            kind: "kikyou-silk",
            combatKind: "zone",
            lifecycle: "owner-bound",
            borrowedAttackPersistence: true,
            life: Number.MAX_SAFE_INTEGER,
            drawLayer: "background",
            color: ball.color,
            start: anchor,
            end: ball,
            shieldBreakPoints: [anchor],
            shieldBreakRadius: 1,
            anchorX,
            anchorY,
            touchingTargets: new Set(),
            drawBatch: drawSilkBatch,
            update({ entity, services: silkServices }) {
              const owner = entity.owner;
              const previousOwnerX = Number.isFinite(owner.prevX) ? owner.prevX : owner.x;
              const previousOwnerY = Number.isFinite(owner.prevY) ? owner.prevY : owner.y;
              const silkMoveX = owner.x - previousOwnerX;
              const silkMoveY = owner.y - previousOwnerY;
              const silkMoved = (
                silkMoveX * silkMoveX + silkMoveY * silkMoveY > EPSILON_SQUARED
              );
              silkServices.forEachEnemy((target) => {
                const targetMoveX = target.x - target.prevX;
                const targetMoveY = target.y - target.prevY;
                const contactGeometryMoved = silkMoved || (
                  targetMoveX * targetMoveX + targetMoveY * targetMoveY > EPSILON_SQUARED
                );
                const touchRadius = target.radius + SILK_HALF_WIDTH;
                const wasTouching = entity.touchingTargets.has(target);
                const isTouching = currentlyTouchesSilk(target, entity, owner, touchRadius);
                if (
                  !wasTouching &&
                  contactGeometryMoved &&
                  (isTouching || sweepTouchesSilk(
                    target,
                    entity,
                    owner,
                    previousOwnerX,
                    previousOwnerY,
                    touchRadius
                  ))
                ) {
                  const dealt = silkServices.dealDamage(target, DAMAGE_PER_CROSSING);
                  if (dealt) spawnSilkContactBurst(silkServices, entity, owner, target);
                }
                if (isTouching) entity.touchingTargets.add(target);
                else if (wasTouching) entity.touchingTargets.delete(target);
              });
            },
            draw({ entity }, canvasContext) {
              drawSilk(canvasContext, entity);
            }
          });
          spawnSilkSpinBurst(services, ball, anchor.x, anchor.y);
        }
      };
    }
  };

  registerBall(spiderwebDefinition);
  return {
    spiderwebDefinition,
    spiderwebSweepTouchesSilk: sweepTouchesSilk,
    spiderwebCurrentlyTouchesSilk: currentlyTouchesSilk,
    drawSpiderwebSilk: drawSilk,
    SPIDERWEB_SILK_HALF_WIDTH: SILK_HALF_WIDTH
  };
});
