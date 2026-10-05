// Полнота сита: выборка (recall_sample.mjs) + вывод «vanity.exe flags» → сколько адресов с данным score пропускает сито.
//   node src/recall_eval.mjs data/recall/s200.jsonl data/recall/flags.txt [--miss 20]
// В flags: «флаг W биты v5lite×10 адрес»; бит 1 флага — старое сито, бит 2 — v5-lite.
import fs from 'node:fs';
const [, , sampleF, flagsF] = process.argv;
const missN = Number(process.argv[process.argv.indexOf('--miss') + 1]) || 0;
const rows = fs.readFileSync(sampleF, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const F = new Map();
for (const l of fs.readFileSync(flagsF, 'utf8').split('\n')) { const p = l.trim().split(' '); if (p.length >= 5) F.set(p[4], { f: +p[0], a: +p[3] }); }
const d = rows.filter((r) => F.has(r.uq)).map((r) => ({ ...r, ...F.get(r.uq) }));
const near = d.filter((r) => Math.abs(r.score - r.a) <= 2).length;
console.log(`адресов ${d.length}; оценка GPU = v5 ±2 очка: ${(100 * near / d.length).toFixed(1)}%`);
for (const lo of [100, 120, 140, 150, 170, 200]) {
  const s = d.filter((r) => r.score >= lo); if (!s.length) continue;
  const old = s.filter((r) => r.f & 1).length, nw = s.filter((r) => r.f & 2).length;
  console.log(`score ≥${lo}: ${String(s.length).padStart(5)}  старое сито ${(100 * old / s.length).toFixed(0).padStart(3)}%   v5-lite ${(100 * nw / s.length).toFixed(0).padStart(3)}%`);
}
if (missN) for (const r of d.filter((r) => r.score >= 140 && !(r.f & 2)).sort((a, b) => b.score - a.score).slice(0, missN))
  console.log('MISS', r.score, 'gpu', r.a, r.label, r.uq.slice(-22), '|', r.reasons.slice(0, 2).join('; '));
const off = d.filter((r) => Math.abs(r.score - r.a) > 2 && r.score >= 120).sort((a, b) => Math.abs(b.score - b.a) - Math.abs(a.score - a.a)).slice(0, missN);
for (const r of off) console.log('DIFF', r.score, 'gpu', r.a, r.label, r.uq.slice(-22), '|', r.reasons.slice(0, 2).join('; '));
