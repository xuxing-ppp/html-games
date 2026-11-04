import { analyze, buildLine, subdivide } from './analyze2.mjs';
import { readFileSync, writeFileSync } from 'fs';

const html = readFileSync(new URL('../src/world/tracks.js', import.meta.url), 'utf8');
const m = html.match(/const TRACKS = (\[[\s\S]*?\]);/);
const TRACKS = new Function('return ' + m[1])();

console.log('=== 细分前后对比 ===');
console.log('赛道'.padEnd(8), ' | 前: 角/周长/minR/自交/颈  ->  后: 角/周长/minR/自交/颈');
const NEW = [];
for (const t of TRACKS) {
  const before = analyze(t.name, t.verts, t.R);
  // 长边细分(朝外加弯). 阈值 200; 若仍过紧则提高该赛道倒角半径
  let v2 = subdivide(t.verts, 200);
  let R = t.R;
  let after = analyze(t.name, v2, R);
  // 自交则放大阈值(少细分); 过紧则加 R
  for (let iter = 0; iter < 6 && (after.si > 0 || after.minR < 20 || after.neck < 30); iter++) {
    if (after.si > 0) v2 = subdivide(t.verts, 260);
    if (after.minR < 20) R += 4;
    after = analyze(t.name, v2, R);
  }
  NEW.push({ name: t.name, theme: t.theme, R, verts: v2 });
  console.log(t.name.padEnd(8),
    `| 前: ${before.corners}/${before.perim.toFixed(0)}/${before.minR.toFixed(0)}/${before.si}/${before.neck.toFixed(0)}  ->  后: ${after.corners}/${after.perim.toFixed(0)}/${after.minR.toFixed(0)}/${after.si}/${after.neck.toFixed(0)}`);
}
// 输出新 TRACKS 条目
let out = '';
for (const t of NEW) {
  const vs = t.verts.map(v => `[${v[0]},${v[1]}]`).join(',');
  out += `  { name: '${t.name}', theme: '${t.theme}', R: ${t.R}, verts: [${vs}] },\n`;
}
writeFileSync('/tmp/new_tracks.txt', out);
console.log('\n新 TRACKS 写入 /tmp/new_tracks.txt');
