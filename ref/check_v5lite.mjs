// Сверка сита v5-lite (оценка v5 на видеокарте) с настоящей оценкой src/score_v5.mjs.
// 3000 детерминированных «адресов» со вставленными словами и фразами (в конце, в начале, в середине; разный регистр и
// разделители) → ядро в режиме flags считает приближённые очки → сравниваем с scoreV5. Адреса — просто строки, ключей нет.
//   node ref/check_v5lite.mjs            (нужен собранный cuda/vanity.exe)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scoreV5 } from '../src/score_v5.mjs';
import { SLANG_SET } from '../src/gems.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = path.join(ROOT, 'cuda', process.platform === 'win32' ? 'vanity.exe' : 'vanity');
let seed = 20261005;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const zipfWords = fs.readFileSync(path.join(ROOT, 'data', 'en_zipf.tsv'), 'utf8').split('\n').slice(0, 8000).map((l) => l.split('\t')[0]).filter((w) => /^[a-z]{2,9}$/.test(w));
const words = [...SLANG_SET].filter((w) => /^[a-z]{3,9}$/.test(w)).concat(zipfWords);
const styl = (w) => { const r = rnd(); if (r < 0.3) return w; if (r < 0.55) return w.toUpperCase(); if (r < 0.8) return w[0].toUpperCase() + w.slice(1);
  return [...w].map((c) => (rnd() < 0.5 ? c.toUpperCase() : c)).join(''); };
const sep = () => { const r = rnd(); return r < 0.3 ? '' : r < 0.55 ? '_' : r < 0.75 ? '-' : String(Math.floor(rnd() * 10)); };
const cases = [];
for (let n = 0; n < 3000; n++) {
  let body = Array.from({ length: 46 }, () => B64[Math.floor(rnd() * 64)]).join('');
  const k = 1 + Math.floor(rnd() * 3);
  let phrase = ''; for (let i = 0; i < k; i++) phrase += (i ? sep() : '') + styl(pick(words));
  if (rnd() < 0.15) phrase = phrase.replace(/([a-z])/i, (c) => c.repeat(2 + Math.floor(rnd() * 4)));   // растяжка
  phrase = phrase.slice(0, 20);
  // фраза ровно в конце / в начале / в середине («почти хвост» с мусором после фразы ядро не считает — см. v5lite.inc)
  const where = rnd(), sp = sep();
  if (where < 0.65) body = body.slice(0, 46 - phrase.length - sp.length) + sp + phrase;
  else if (where < 0.9) body = (phrase + sp + body).slice(0, 46);
  else { const p = 5 + Math.floor(rnd() * 15); body = (body.slice(0, p) + sp + phrase + sep() + body.slice(p)).slice(0, 46); }
  cases.push('UQ' + body);
}
const file = path.join(ROOT, 'cuda', 'v5check.txt');
fs.writeFileSync(file, cases.join('\n') + '\n');
const out = execFileSync(exe, ['flags', file, '--all-dist', '22', '--v5t', '140'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
fs.unlinkSync(file);
const gpu = new Map(out.trim().split(/\r?\n/).map((l) => { const p = l.trim().split(' '); return [p[4], { f: +p[0], a: +p[3] }]; }));
let near = 0, ok150 = 0, n150 = 0, worst = [];
for (const uq of cases) {
  const s = scoreV5(uq).score, g = gpu.get(uq);
  if (!g) continue;
  if (Math.abs(s - g.a) <= 2) near++; else worst.push([Math.abs(s - g.a), s, g.a, uq]);
  if (s >= 150) { n150++; if (g.f & 2) ok150++; }
}
worst.sort((a, b) => b[0] - a[0]);
const pct = (100 * near / cases.length).toFixed(1), rec = n150 ? (100 * ok150 / n150).toFixed(1) : '100';
console.log(`v5-lite: оценка GPU = v5 ±2 очка у ${pct}% из ${cases.length}; полнота при 150+: ${rec}% (${ok150}/${n150})`);
if (process.argv.includes('-v')) for (const w of worst.slice(0, 15)) console.log('  ', w[1], 'gpu', w[2], w[3]);
process.exit(near / cases.length >= 0.95 && (!n150 || ok150 / n150 >= 0.95) ? 0 : 1);
