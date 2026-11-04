const GDEG = Math.PI / 180;
// 由多边形顶点(凹凸均可) + 角半径生成密集中线. 每个角用圆弧轻度倒角, 保留棱角感.
// t = R·tan(|turn|/2) (切距); 近直顶点(|turn|<25°)直通; 边短时按 maxT 钳制.
function buildLine(verts, cornerR) {
  const n = verts.length, SAMPLE = 12;
  const corners = [];
  for (let i = 0; i < n; i++) {
    const prev = verts[(i - 1 + n) % n], cur = verts[i], next = verts[(i + 1) % n];
    const eIn = [cur[0] - prev[0], cur[1] - prev[1]], lenIn = Math.hypot(eIn[0], eIn[1]);
    const eOut = [next[0] - cur[0], next[1] - cur[1]], lenOut = Math.hypot(eOut[0], eOut[1]);
    const din = [eIn[0] / lenIn, eIn[1] / lenIn], dout = [eOut[0] / lenOut, eOut[1] / lenOut];
    const cross = din[0] * dout[1] - din[1] * dout[0], dot = din[0] * dout[0] + din[1] * dout[1];
    const turn = Math.atan2(cross, dot), half = Math.abs(turn) / 2;
    const tFull = cornerR * Math.tan(half), maxT = Math.min(lenIn, lenOut) * 0.46;
    let flat = false, t, rEff;
    if (Math.abs(turn) < 25 * GDEG) { flat = true; t = 0; rEff = 1e6; }
    else if (tFull <= maxT) { t = tFull; rEff = cornerR; }
    else { t = maxT; rEff = maxT / Math.tan(half); }
    corners.push({ A: [cur[0] - din[0] * t, cur[1] - din[1] * t], B: [cur[0] + dout[0] * t, cur[1] + dout[1] * t], cur, turn, t, rEff, din, dout, convex: turn > 0, flat });
  }
  const pts = [];
  for (let i = 0; i < n; i++) {
    const c = corners[i], cn = corners[(i + 1) % n];
    if (!c.flat) {
      const nx = c.convex ? -c.din[1] : c.din[1], nz = c.convex ? c.din[0] : -c.din[0];
      const C = [c.A[0] + nx * c.rEff, c.A[1] + nz * c.rEff];
      const angA = Math.atan2(c.A[1] - C[1], c.A[0] - C[0]), angB = Math.atan2(c.B[1] - C[1], c.B[0] - C[0]);
      let span = angB - angA;
      if (c.convex) { if (span < 0) span += Math.PI * 2; } else { if (span > 0) span -= Math.PI * 2; }
      const aSteps = Math.max(3, Math.round(Math.abs(span) * c.rEff / SAMPLE));
      for (let s = 1; s <= aSteps; s++) { const a = angA + span * s / aSteps; pts.push([C[0] + Math.cos(a) * c.rEff, C[1] + Math.sin(a) * c.rEff]); }
    }
    const ev = [cn.A[0] - c.B[0], cn.A[1] - c.B[1]], L = Math.hypot(ev[0], ev[1]);
    const d = [ev[0] / L, ev[1] / L];
    const eSteps = Math.max(2, Math.round(L / SAMPLE));
    for (let s = 1; s <= eSteps; s++) { const f = s / eSteps; pts.push([c.B[0] + d[0] * L * f, c.B[1] + d[1] * L * f]); }
  }
  return pts;
}
// 等弧长重采样密集中线为 N 个点(闭合)
function resamplePoly(pts, count) {
  const M = pts.length; const seg = [];
  let total = 0;
  for (let i = 0; i < M; i++) { const a = pts[i], b = pts[(i + 1) % M]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); seg.push(l); total += l; }
  const step = total / count; const out = []; let acc = 0, si = 0, remain = seg[0];
  for (let k = 0; k < count; k++) {
    let dist = k * step - acc;
    while (dist > remain) { acc += remain; si = (si + 1) % M; remain = seg[si]; dist = k * step - acc; }
    const a = pts[si], b = pts[(si + 1) % M]; const f = remain > 0 ? (dist + (seg[si] - remain)) / seg[si] : 0;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}


export { buildLine, resamplePoly };
