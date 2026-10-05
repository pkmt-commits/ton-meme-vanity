// Словарь оценки v5 для видеокарты → cuda/v5dict.h (сито «v5-lite»: разбор хвоста и начала на слова прямо на GPU).
// Берём ровно тот словарь и те же веса, что у score_v5.mjs: слово, длина, база выигрыша 5·len − (9−zipf)·log2(10),
// множитель служебных слов, бонус темы/сленга/личной оценки, флаги «длинное» и «содержательное».
//   node src/gpu_dict_v5.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// внутренности score_v5 не экспортируются — подключаем копию модуля с экспортом нужного
const src = fs.readFileSync(path.join(here, 'score_v5.mjs'), 'utf8').replace(/^﻿/, '');
const tmp = path.join(here, '.score_v5_dict.tmp.mjs');
fs.writeFileSync(tmp, src + '\nexport { Z, THEME, VOTES, FUNC2 };\n');
const { Z, THEME, VOTES, FUNC2, P5, SLANG_SET } = await import(pathToFileURL(tmp).href).then(async (m) => ({ ...m, SLANG_SET: (await import('./gems.mjs')).SLANG_SET }));
fs.unlinkSync(tmp);

const MAXL = 16;
const rows = [];
for (const [w, z] of Z) {
  if (!/^[a-z0-9]+$/.test(w) || w.length >= MAXL) continue;
  const alpha = /^[a-z]+$/.test(w);
  const content = w.length >= 3 || THEME.has(w);
  const funcMul = !content || (FUNC2.has(w) && w.length <= 3);
  let bonus = THEME.has(w) ? P5.themeBonus : SLANG_SET.has(w) ? P5.strongBonus : 0;
  const v = VOTES.get(w); if (v > 0) bonus += P5.wordLike; else if (v < 0) bonus -= P5.wordDislike;
  const base = P5.bitsPerChar * w.length - (9 - z) * Math.log2(10);
  const long = w.length >= P5.minContent || SLANG_SET.has(w);
  const contentF = (content && !FUNC2.has(w)) || SLANG_SET.has(w);
  const slang = SLANG_SET.has(w);
  rows.push({ w, base, bonus, flags: (alpha ? 1 : 0) | (funcMul ? 2 : 0) | (long ? 4 : 0) | (contentF ? 8 : 0) | (slang ? 16 : 0) });
}
rows.sort((a, b) => (a.w < b.w ? -1 : 1));
const f = (x) => { const v = Math.round(x * 1e4) / 1e4; const t = v.toString(); return (/[.e]/.test(t) ? t : t + '.0') + 'f'; };
let h = `// auto-generated src/gpu_dict_v5.mjs из score_v5.mjs: ${rows.length} слов (тот же словарь и веса, что у оценки v5)\n`;
h += `#define V5N ${rows.length}\n#define V5MAXL ${MAXL}\n`;
h += `__device__ char V5W[V5N][V5MAXL] = {${rows.map((r) => JSON.stringify(r.w)).join(',')}};\n`;
h += `__device__ unsigned char V5LEN[V5N] = {${rows.map((r) => r.w.length).join(',')}};\n`;
h += `__device__ float V5BASE[V5N] = {${rows.map((r) => f(r.base)).join(',')}};\n`;
h += `__device__ float V5BONUS[V5N] = {${rows.map((r) => f(r.bonus)).join(',')}};\n`;
h += `__device__ unsigned char V5FLAGS[V5N] = {${rows.map((r) => r.flags).join(',')}};   // 1 буквенное, 2 ×funcK, 4 длинное, 8 содержательное, 16 сленг\n`;
// веса P5, которые нужны ядру
const keys = ['bitsPerChar', 'stretchGain', 'stretchCap', 'leetCost', 'funcK', 'vis', 'visDigit', 'visCase', 'visCamel', 'visMixed', 'sepDouble', 'sepCase',
  'digitToFor', 'digitSep', 'startAD', 'startTheme', 'start3', 'start3Vis', 'startK', 'singleK', 'face'];
for (const k of keys) h += `#define P5_${k} ${f(P5[k])}\n`;
const out = path.join(here, '..', 'cuda', 'v5dict.h');
if (fs.existsSync(out) && fs.readFileSync(out, 'utf8') === h) console.log(`словарь сита v5-lite: ${rows.length} слов, без изменений`);
else { fs.writeFileSync(out, h); console.log(`cuda/v5dict.h: ${rows.length} слов, ${(h.length / 1024).toFixed(0)} КБ — обновлён`); }
