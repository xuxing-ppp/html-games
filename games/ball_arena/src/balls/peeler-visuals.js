(function initializePeelerVisuals(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createPeelerVisuals() {
  "use strict";

  const TAU = Math.PI * 2;
  // The peeled strip reaches the shell first; the shell ring then winds shut.
  const TIMING = Object.freeze({ stripFlight: 0.14, shellForm: 0.32, scarFade: 0.6, shellBreak: 0.35 });
  const SLICE_PORTION = 0.24;
  const SHELL_LINE_WIDTH = 2.4;
  const BLADE_TIP_X = 3.8;

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function smooth(value) {
    const progress = clamp01(value);
    return progress * progress * (3 - 2 * progress);
  }

  function easeOutCubic(value) {
    const inverse = 1 - clamp01(value);
    return 1 - inverse * inverse * inverse;
  }

  function easeOutBack(value) {
    const progress = clamp01(value) - 1;
    return 1 + progress * progress * (2.4 * progress + 1.4);
  }

  function mixHex(color, other, amount) {
    const parse = (hex) => {
      const value = /^#([0-9a-f]{6})$/i.exec(hex || "");
      const number = value ? parseInt(value[1], 16) : 0x888888;
      return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
    };
    const a = parse(color);
    const b = parse(other);
    const channel = (index) => Math.round(a[index] + (b[index] - a[index]) * amount);
    return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
  }

  function drawKnifeShape(ctx) {
    // The handle and open fork make this a Y-peeler, not a short sword.
    ctx.beginPath();
    ctx.moveTo(-17, -1.7);
    ctx.quadraticCurveTo(-18.6, 0, -17, 1.7);
    ctx.lineTo(-7.6, 2.2);
    ctx.quadraticCurveTo(-6.4, 0, -7.6, -2.2);
    ctx.closePath();
    ctx.fillStyle = "#b49580";
    ctx.strokeStyle = "#6f5b4d";
    ctx.lineWidth = 0.65;
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "#9ca6ab";
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-7.8, 0);
    ctx.lineTo(-4.8, 0);
    ctx.moveTo(-4.8, 0);
    ctx.lineTo(-1.2, -6.3);
    ctx.lineTo(1.5, -6.3);
    ctx.moveTo(-4.8, 0);
    ctx.lineTo(-1.2, 6.3);
    ctx.lineTo(1.5, 6.3);
    ctx.stroke();

    ctx.fillStyle = "#dce4e8";
    ctx.strokeStyle = "#737e84";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-0.8, -7.4);
    ctx.lineTo(3.4, -7.4);
    ctx.lineTo(4.1, 7.4);
    ctx.lineTo(-0.8, 7.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // A long dark slot and a bright cutting edge identify the transverse blade.
    ctx.strokeStyle = "#69777e";
    ctx.lineWidth = 0.95;
    ctx.beginPath();
    ctx.moveTo(1.1, -5.7);
    ctx.lineTo(1.35, 5.7);
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(3.4, -6.4);
    ctx.lineTo(3.95, 6.4);
    ctx.stroke();
  }

  // Knife poses are in the owner's local frame: +x points at the aimed enemy.
  // Angles keep the handle tangent to the body so it never covers the HP label.
  function idlePose(radius, clock) {
    const breath = Math.sin(clock * 3.2);
    return {
      x: radius * 0.85,
      y: radius * 0.95 + breath * 0.9,
      angle: -0.25 + Math.sin(clock * 3.2 + 1.1) * 0.05
    };
  }

  function readyPose(radius) {
    return { x: radius, y: -radius, angle: 0.25 };
  }

  function sliceEndPose(radius) {
    return { x: radius, y: radius * 1.05, angle: -0.3 };
  }

  function lerpPose(from, to, amount) {
    return {
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount,
      angle: from.angle + (to.angle - from.angle) * amount
    };
  }

  function restingPose(radius, readiness, clock) {
    return lerpPose(idlePose(radius, clock), readyPose(radius), smooth(readiness));
  }

  function slicePose(radius, from, sweep) {
    const pose = lerpPose(from, sliceEndPose(radius), sweep);
    // The blade presses forward through the contact point at mid-swing.
    pose.x += Math.sin(sweep * Math.PI) * radius * 0.35;
    return pose;
  }

  function bladeTip(pose) {
    return {
      x: pose.x + Math.cos(pose.angle) * BLADE_TIP_X,
      y: pose.y + Math.sin(pose.angle) * BLADE_TIP_X
    };
  }

  function drawSliceTrail(ctx, radius, from, sweep, fade) {
    const samples = 9;
    const tail = Math.max(0, sweep - 0.75);
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "#eef7ff";
    let previous = bladeTip(slicePose(radius, from, tail));
    for (let index = 1; index <= samples; index += 1) {
      const amount = tail + (sweep - tail) * index / samples;
      const point = bladeTip(slicePose(radius, from, amount));
      ctx.globalAlpha = fade * (index / samples) * 0.85;
      ctx.lineWidth = 0.6 + 1.8 * index / samples;
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      previous = point;
    }
    ctx.restore();
  }

  function peelerDrawKnife({
    ball, heading = 0, strokeProgress = null, readiness = 0,
    strikeReadiness = readiness, clock = 0
  }, ctx) {
    const radius = ball.radius;
    const progress = strokeProgress === null ? null : clamp01(strokeProgress);
    let pose = restingPose(radius, readiness, clock);
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(heading);
    if (progress !== null) {
      const from = restingPose(radius, strikeReadiness, clock);
      if (progress < SLICE_PORTION) {
        const sweep = easeOutCubic(progress / SLICE_PORTION);
        pose = slicePose(radius, from, sweep);
        drawSliceTrail(ctx, radius, from, sweep, 1);
      } else {
        const recover = (progress - SLICE_PORTION) / (1 - SLICE_PORTION);
        // The trail lingers briefly while the knife springs back to its grip.
        const linger = 1 - smooth(recover / 0.35);
        if (linger > 0) drawSliceTrail(ctx, radius, from, 1, linger);
        pose = lerpPose(sliceEndPose(radius), restingPose(radius, readiness, clock), easeOutBack(recover));
      }
    }
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.angle);
    drawKnifeShape(ctx);
    ctx.restore();
  }

  // formation 0..1 winds the ring shut from its seam; breakProgress 0..1 splits it apart.
  function peelerDrawShell({ ball, color, seamAngle = 0, formation = 1, breakProgress = 0 }, ctx) {
    const radius = Math.max(0.5, ball.radius - SHELL_LINE_WIDTH / 2);
    const form = smooth(formation);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = SHELL_LINE_WIDTH;
    ctx.lineCap = "round";
    if (breakProgress > 0) {
      const burst = easeOutCubic(breakProgress);
      for (let index = 0; index < 4; index += 1) {
        const center = seamAngle + Math.PI / 4 + index * Math.PI / 2;
        const halfSpan = (Math.PI / 4 - 0.14) * (1 - burst * 0.4);
        const drift = burst * 7;
        const twist = (index % 2 === 0 ? 1 : -1) * burst * 0.45;
        ctx.beginPath();
        ctx.arc(ball.x + Math.cos(center) * drift, ball.y + Math.sin(center) * drift,
          radius, center + twist - halfSpan, center + twist + halfSpan);
        ctx.stroke();
      }
    } else if (form >= 1) {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, radius, 0, TAU);
      ctx.stroke();
    } else if (form > 0) {
      // Both halves grow from the seam where the peeled strip arrived.
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, radius, seamAngle - Math.PI * form, seamAngle + Math.PI * form);
      ctx.stroke();
    }
    ctx.restore();
    return true;
  }

  function peelerShellFormation(age) {
    return clamp01((age - TIMING.stripFlight) / TIMING.shellForm);
  }

  function peelerShellBreak(sinceDeath) {
    return clamp01(sinceDeath / TIMING.shellBreak);
  }

  function quadraticPoint(start, control, end, amount) {
    const inverse = 1 - amount;
    return {
      x: inverse * inverse * start.x + 2 * inverse * amount * control.x + amount * amount * end.x,
      y: inverse * inverse * start.y + 2 * inverse * amount * control.y + amount * amount * end.y
    };
  }

  function peelerCreatePeelEffect(target, shell, heading) {
    const color = target.color;
    const backColor = mixHex(color, "#f4ead8", 0.62);
    // Angle on the victim facing the knife, and angle on the shell facing the victim.
    const cutAngle = heading + Math.PI;
    const seamAngle = Math.atan2(target.y - shell.y, target.x - shell.x);
    const curlSide = Math.sin(seamAngle - heading) >= 0 ? 1 : -1;
    let lastTarget = { x: target.x, y: target.y };
    return {
      kind: "peeler-skin-release",
      life: Math.max(TIMING.stripFlight + TIMING.shellForm, TIMING.scarFade),
      seamAngle,
      draw({ effect }, ctx) {
        const age = effect.age;
        if (target.hp > 0) lastTarget = { x: target.x, y: target.y };
        const start = {
          x: lastTarget.x + Math.cos(cutAngle) * target.radius,
          y: lastTarget.y + Math.sin(cutAngle) * target.radius
        };
        const end = {
          x: shell.x + Math.cos(seamAngle) * shell.radius,
          y: shell.y + Math.sin(seamAngle) * shell.radius
        };
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const span = Math.hypot(dx, dy) || 1;
        const bulge = Math.min(span * 0.45, 18) * curlSide;
        const control = {
          x: (start.x + end.x) / 2 - dy / span * bulge,
          y: (start.y + end.y) / 2 + dx / span * bulge
        };

        ctx.save();
        ctx.lineCap = "round";
        // A pale scar stays on the victim where the skin strip came off.
        const scar = 1 - smooth(age / TIMING.scarFade);
        if (scar > 0 && target.hp > 0) {
          ctx.globalAlpha *= scar;
          ctx.strokeStyle = backColor;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(lastTarget.x, lastTarget.y, Math.max(0.5, target.radius - 1.4),
            cutAngle - 0.62, cutAngle + 0.62);
          ctx.stroke();
          ctx.globalAlpha /= scar;
        }

        // The strip flies to the shell, then is reeled in as the ring winds shut.
        const head = easeOutCubic(age / TIMING.stripFlight);
        const tail = smooth((age - TIMING.stripFlight) / TIMING.shellForm);
        if (head - tail > 0.01) {
          const segments = 14;
          let previous = quadraticPoint(start, control, end, tail);
          for (let index = 1; index <= segments; index += 1) {
            const amount = tail + (head - tail) * index / segments;
            const point = quadraticPoint(start, control, end, amount);
            const local = index / segments;
            // Alternating faces read as the thin strip twisting in flight.
            const twist = Math.sin(amount * Math.PI * 5 - age * 24);
            ctx.strokeStyle = twist >= 0 ? color : backColor;
            ctx.lineWidth = 0.9 + 2.1 * Math.sin(local * Math.PI) * (0.55 + 0.45 * Math.abs(twist));
            ctx.beginPath();
            ctx.moveTo(previous.x, previous.y);
            ctx.lineTo(point.x, point.y);
            ctx.stroke();
            previous = point;
          }
        }
        ctx.restore();
      }
    };
  }

  return {
    PEELER_VISUAL_TIMING: TIMING,
    peelerDrawKnife,
    peelerDrawShell,
    peelerShellFormation,
    peelerShellBreak,
    peelerCreatePeelEffect
  };
});
