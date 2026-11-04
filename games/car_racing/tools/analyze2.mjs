// 凹多边形分析(纯JS): 周长/单圈/自交/minR/窄颈/reflex + 角数
const GDEG = Math.PI / 180;
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
    corners.push({ A: [cur[0] - din[0] * t, cur[1] - din[1] * t], B: [cur[0] + dout[0] * t, cur[1] + dout[1] * t], turn, rEff, din, dout, convex: turn > 0, flat });
  }
  const pts = [];
  for (let i = 0; i < n; i++) {
    const c = corners[i], cn = corners[(i + 1) % n];
    if (!c.flat) {
      const nx = c.convex ? -c.din[1] : c.din[1], nz = c.convex ? c.din[0] : -c.din[0];
      const C = [c.A[0] + nx * c.rEff, c.A[1] + nz * c.rEff];
      const angA = Math.atan2(c.A[1] - C[1], c.A[0] - C[0]);
      let span = (Math.atan2(c.B[1] - C[1], c.B[0] - C[0])) - angA;
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
function circR(p0, p1, p2) { const ax = p1[0] - p0[0], az = p1[1] - p0[1], bx = p2[0] - p1[0], bz = p2[1] - p1[1]; const a = Math.hypot(ax, az), b = Math.hypot(bx, bz), c = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]); const area = Math.abs(ax * bz - az * bx) * 0.5; if (area < 1e-6) return Infinity; return (a * b * c) / (4 * area); }
function minR(pts) { const M = pts.length; let m = Infinity; for (let i = 0; i < M; i++) { const r = circR(pts[(i - 1 + M) % M], pts[i], pts[(i + 1) % M]); if (r < m) m = r; } return m; }
function perim(pts) { const M = pts.length; let p = 0; for (let i = 0; i < M; i++) p += Math.hypot(pts[(i + 1) % M][0] - pts[i][0], pts[(i + 1) % M][1] - pts[i][1]); return p; }
function segInt(p1, p2, p3, p4) { const d1x = p2[0] - p1[0], d1z = p2[1] - p1[1], d2x = p4[0] - p3[0], d2z = p4[1] - p3[1]; const den = d1x * d2z - d1z * d2x; if (Math.abs(den) < 1e-9) return false; const s = ((p3[0] - p1[0]) * d2z - (p3[1] - p1[1]) * d2x) / den; const t = ((p3[0] - p1[0]) * d1z - (p3[1] - p1[1]) * d1x) / den; return s > 0.02 && s < 0.98 && t > 0.02 && t < 0.98; }
function selfInt(pts) { const M = pts.length; let c = 0; for (let i = 0; i < M; i++) for (let j = i + 3; j < M; j++) { if (Math.min(Math.abs(i - j), M - Math.abs(i - j)) < 3) continue; if (segInt(pts[i], pts[(i + 1) % M], pts[j], pts[(j + 1) % M])) c++; } return c; }
function neck(pts) { const M = pts.length; let m = Infinity; for (let i = 0; i < M; i++) for (let j = i + 6; j < M; j++) { if (Math.min(Math.abs(i - j), M - Math.abs(i - j)) < 6) continue; let d = Infinity; for (let a = 0; a <= 1; a += 0.25) for (let b = 0; b <= 1; b += 0.25) { const x1 = pts[i][0] + (pts[(i + 1) % M][0] - pts[i][0]) * a, z1 = pts[i][1] + (pts[(i + 1) % M][1] - pts[i][1]) * a; const x2 = pts[j][0] + (pts[(j + 1) % M][0] - pts[j][0]) * b, z2 = pts[j][1] + (pts[(j + 1) % M][1] - pts[j][1]) * b; d = Math.min(d, Math.hypot(x1 - x2, z1 - z2)); } if (d < m) m = d; } return m; }
// 角数: turn>25° 的顶点数
function cornerCount(verts) { const n = verts.length; let c = 0; for (let i = 0; i < n; i++) { const p = verts[(i - 1 + n) % n], cu = verts[i], nx = verts[(i + 1) % n]; const dx1 = cu[0] - p[0], dz1 = cu[1] - p[1], dx2 = nx[0] - cu[0], dz2 = nx[1] - cu[1]; const cross = dx1 * dz2 - dz1 * dx2, dot = dx1 * dx2 + dz1 * dz2; if (Math.abs(Math.atan2(cross, dot)) > 25 * GDEG) c++; } return c; }
// 最长直道: 中线点中曲率小(半径>200)的最长连续段长度
function maxStraight(pts) {
  const M = pts.length; let best = 0, cur = 0, prev = null;
  for (let i = 0; i < M; i++) {
    const r = circR(pts[(i - 1 + M) % M], pts[i], pts[(i + 1) % M]);
    const seg = Math.hypot(pts[(i + 1) % M][0] - pts[i][0], pts[(i + 1) % M][1] - pts[i][1]);
    if (r > 200) cur += seg; else { best = Math.max(best, cur); cur = 0; }
  }
  return Math.max(best, cur);
}
export function analyze(name, verts, R) {
  const pts = buildLine(verts, R); const P = perim(pts);
  return { name, perim: P, lap: P / 32, minR: minR(pts), si: selfInt(pts), neck: neck(pts), corners: cornerCount(verts), straight: maxStraight(pts) };
}
export { buildLine };

// 长边细分: 在长边朝外(远离重心)插入 1-2 个偏移顶点 -> 打断直道为短直道+弯, 不自交
export function subdivide(verts, threshold) {
  const n = verts.length;
  // 重心
  let cxx = 0, czz = 0; for (const v of verts) { cxx += v[0]; czz += v[1]; }
  cxx /= n; czz /= n;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(verts[i]);
    const a = verts[i], b = verts[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L > threshold) {
      const k = L > 820 ? 2 : 1;           // 超长边插2点
      const amp = Math.min(0.12 * L, 62);  // 振幅按边长(温和, 弯角~28°), 保证 R 够
      const px = -dz / L, pz = dx / L;     // 边的左法线
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      // 判断左法线是否朝向重心(内), 若是则外向=-法线
      const inward = ((cxx - mx) * px + (czz - mz) * pz) > 0;
      const sgn = inward ? -1 : 1;
      for (let j = 1; j <= k; j++) {
        const f = j / (k + 1);
        const bx = a[0] + dx * f, bz = a[1] + dz * f;
        out.push([Math.round(bx + px * amp * sgn), Math.round(bz + pz * amp * sgn)]);
      }
    }
  }
  return out;
}
