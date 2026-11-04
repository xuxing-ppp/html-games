import { analyze } from './analyze2.mjs';
import { writeFileSync } from 'fs';
import { ORIG } from './designs_orig.mjs';

const SCALE = 1.15;                            // 基底放大 -> 直道更长
const sc = v => v.map(([x, z]) => [Math.round(x * SCALE), Math.round(z * SCALE)]);

// 长边(>=525)保留为长直道; 短边(所有 280-525)各插 2 个急 kink -> 弯间距更大的急弯对. 长直道+疏密适中的急弯.
function subdividePartial(verts, ampRatio) {
  const out = []; const n = verts.length;
  for (let i = 0; i < n; i++) {
    out.push(verts[i]);
    const a = verts[i], b = verts[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L > 280 && L < 525) {                      // 短边 -> 急弯对(2 kink, 间距大); 长边保留直道
      const k = 2;
      const segLen = L / (k + 1);
      const amp = segLen * ampRatio;
      const px = -dz / L, pz = dx / L;
      for (let j = 1; j <= k; j++) {
        const f = j / (k + 1);
        const bx = a[0] + dx * f, bz = a[1] + dz * f;
        const s = (j % 2 === 0) ? 1 : -1;
        out.push([Math.round(bx + px * amp * s), Math.round(bz + pz * amp * s)]);
      }
    }
  }
  return out;
}

const R = 15;
console.log('赛道'.padEnd(8), '角'.padStart(4), '周长'.padStart(6), '单圈'.padStart(5), 'minR'.padStart(5), '自交'.padStart(4), '颈'.padStart(4), '最长直道'.padStart(7), '  R/amp');
const NEW = [];
for (const [name, theme, ...verts0] of ORIG) {
  const verts = sc(verts0);
  let v2 = verts, after = analyze(name, verts, R), usedAmp = '-', usedR = R;
  outer:
  for (const ampRatio of [0.52, 0.44, 0.36, 0.28, 0.22]) {
    for (const Rtry of [15, 18, 21, 25]) {
      const cand = subdividePartial(verts, ampRatio);
      const a = analyze(name, cand, Rtry);
      if (a.si === 0 && a.minR >= 11 && a.neck >= 26 && a.straight >= 300) {
        v2 = cand; after = a; usedAmp = ampRatio; usedR = Rtry; break outer;
      }
    }
  }
  if (after.si > 0 || after.minR < 10) {
    let best = after, ba = '-', br = R, bv = v2;
    for (const ampRatio of [0.36, 0.28, 0.22, 0.16]) for (const Rtry of [20, 26, 32]) {
      const cand = subdividePartial(verts, ampRatio);
      const a = analyze(name, cand, Rtry);
      if (a.si === 0 && a.minR > best.minR) { best = a; ba = ampRatio; br = Rtry; bv = cand; }
    }
    v2 = bv; after = best; usedAmp = ba; usedR = br;
  }
  NEW.push({ name, theme, R: usedR, verts: v2 });
  let ok = (after.si === 0 && after.minR >= 12 && after.neck >= 26) ? 'OK' : 'CHECK';
  console.log(name.padEnd(8), String(after.corners).padStart(4), after.perim.toFixed(0).padStart(6), after.lap.toFixed(0).padStart(5), after.minR.toFixed(0).padStart(5), String(after.si).padStart(4), after.neck.toFixed(0).padStart(4), after.straight.toFixed(0).padStart(7), `  ${usedR}/${usedAmp} ${ok}`);
}
let out = '';
for (const t of NEW) {
  const vs = t.verts.map(v => `[${v[0]},${v[1]}]`).join(',');
  out += `  { name: '${t.name}', theme: '${t.theme}', R: ${t.R}, verts: [${vs}] },\n`;
}
writeFileSync('/tmp/mix_tracks.txt', out);
console.log('\n写入 /tmp/mix_tracks.txt');
