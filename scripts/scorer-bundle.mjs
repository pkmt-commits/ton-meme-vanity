// Оценщик v5 (src/score_v5.mjs + словари + data/) одним браузерным скриптом без node:fs — для docs/*.html.
// scorerBundle({ target: 'window' | 'self', internals: true }) → строка JS; внутри — тот же код, данные вшиты строками.
// internals: ещё и Z/THEME/VOTES/FUNC2/P5/SLANG_SET (нужны быстрому предфильтру web/lite.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const strip = (s) => s.replace(/^﻿/, '').replace(/^import .*$/gm, '').replace(/^export (const|function|let)/gm, '$1');

export function scorerBundle({ target = 'window', internals = false } = {}) {
  const curated = strip(rd('src/words_curated.mjs'));
  const gems = rd('src/gems.mjs');
  const slang = gems.slice(gems.indexOf('const SLANG = '), gems.indexOf('// большой словарь'));
  const strongLine = gems.match(/const STRONG_ALL = .*\n/);
  if (!slang.startsWith('const SLANG') || !strongLine) throw new Error('src/gems.mjs: не нашёл SLANG / STRONG_ALL — поправьте scripts/scorer-bundle.mjs');
  const score = strip(rd('src/score_v5.mjs'))
    .replace("fs.readFileSync(new URL('../data/en_zipf.tsv', import.meta.url), 'utf8')", 'ZIPF_TSV')
    .replace("fs.readFileSync(new URL('../data/word_votes.json', import.meta.url), 'utf8')", 'VOTES_JSON');
  if (/\bfs\.|import\.meta/.test(score)) throw new Error('src/score_v5.mjs: остались обращения к файлам — поправьте scripts/scorer-bundle.mjs');
  const expose = internals ? `${target}.__v5 = { Z, THEME, VOTES, FUNC2, P5, SLANG_SET };\n` : '';
  return `(function(){\nconst ZIPF_TSV = ${JSON.stringify(rd('data/en_zipf.tsv'))};\nconst VOTES_JSON = ${JSON.stringify(rd('data/word_votes.json'))};\n`
    + `${curated}\n${slang}\n${strongLine[0]}const SLANG_SET = new Set(STRONG_ALL);\n${score}\n${target}.scoreV5 = scoreV5;\n${expose}})();\n`;
}

// сверка: вшитый оценщик даёт те же очки, что Node-версия
export async function checkBundle(bundle) {
  const { scoreV5 } = await import('../src/score_v5.mjs');
  const win = {};
  new Function('window', 'self', bundle)(win, win);
  for (const uq of ['UQC5PS0DCjuLHTFvAy-2WB3TfV5utOrqSHWmBNxY3ah2goaT', 'UQBHZEO8PZ60426yiseuBbJBfSoICVT7TWBuMzW-Baaaaass', 'UQBLyA25xBc6o4Xwq7ZqJvtQ3HDPsgd4xiOXS7xtf219poor']) {
    if (JSON.stringify(win.scoreV5(uq)) !== JSON.stringify(scoreV5(uq))) throw new Error('браузерная оценка разошлась с Node: ' + uq);
  }
  return win;
}
