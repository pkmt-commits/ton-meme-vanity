// Единый словарь «красивых» слов + оценщик гемов. Используется и обёрткой, и (через words.h) ядром.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURATED, THEMED } from './words_curated.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// слова (нижний регистр). Короткие (3-4) ценны в основном с разделителем или в паре.
const SLANG = [...new Set([
  // твои цели
  'durov', 'pizda', 'tonrug', 'rugton', 'egor', 'fuck', 'lfg', 'loh', 'vip', 'rug',
  // крипто
  'moon', 'pump', 'hodl', 'lambo', 'whale', 'degen', 'ape', 'bull', 'bear', 'gem',
  'rich', 'gold', 'cash', 'bank', 'boss', 'king', 'lord', 'god', 'win', 'wagmi',
  'ton', 'gram', 'dogs', 'major', 'notcoin', 'pepe', 'doge', 'hamster',
  // фан / ру-латиница
  'lox', 'kek', 'lol', 'bratan', 'slon', 'rofl', 'krasava', 'vor', 'nagib', 'sila',
  // слова / leet
  'cafe', 'babe', 'dead', 'beef', 'face', 'food', 'code', 'boob', 'feed', 'deed',
  'ace', 'bee', 'f00d', 'c0de', 'b00b', 'm00n', 'g00d', 'g0ld', 'dead', '1337',
  // расширение
  'swag', 'coin', 'swap', 'stake', 'yield', 'mint', 'burn', 'dump', 'shark', 'fomo',
  'chad', 'based', 'alpha', 'giga', 'mega', 'ultra', 'rekt', 'dao', 'defi', 'nft',
  'meme', 'shill', 'bags', 'toncoin', 'stars', 'gift', 'fish', 'cool', 'nice', 'good',
  'best', 'hero', 'star', 'fire', 'top', 'bomba', 'ogon', 'yolo', 'wtf', 'omg',
  'lmao', 'haha', 'hehe', 'c00l', 'b0ss', 'l00t', 'g3m', 'fox', 'cat', 'dog', 'sun', 'ice',
  // ещё батч
  'token', 'rocket', 'diamond', 'hands', 'hold', 'bridge', 'wallet', 'jetton', 'pavel', 'catizen',
  'sigma', 'vibe', 'mood', 'flex', 'drip', 'goat', 'gang', 'crew', 'squad', 'queen',
  'legend', 'epic', 'rare', 'super', 'power', 'magic', 'lucky', 'happy', 'crazy', 'wild',
  'free', 'real', 'true', 'fake', 'love', 'hate', 'hope', 'soul', 'mind', 'dream',
  'life', 'wolf', 'lion', 'owl', 'frog', 'duck', 'crab', 'hawk', 'boom', 'blast',
  'suka', 'blyat', 'davai', 'brat', 'drug', 'tsar', 'medved', 'sobaka', 'norm', 'zbs',
  'pool', 'tool', 'fool', 'book', 'look', 'cook', 'moon', '777', '888', '420', '000', '666',
  'h0dl', 'n00b', 'p00l', 'b00k', 'l00k', 'ser', 'wen', 'cap', 'lit', 'pog',
  // казино-сленг + vault
  'bet', 'vault', 'dice', 'poker', 'slot', 'chip', 'fold', 'raise', 'allin', 'roll',
  'spin', 'prize', 'bonus', 'deal', 'ante', 'flop', 'turn', 'river', 'vegas', 'casino',
  'jackpot', 'odds', 'wager', 'stack', 'bluff', 'call', 'check', 'rake', 'tilt', 'grind',
])];

// большой словарь: сленг + 10k самых частых английских слов (wordfreq, data/en_zipf.tsv; 4-8 букв). GPU — для детекта, JS — для фраз.
let BIG = [];
try { BIG = fs.readFileSync(new URL('../data/en_zipf.tsv', import.meta.url), 'utf8').split(/\r?\n/).slice(0, 10000).map((l) => l.split('\t')[0].trim().toLowerCase()).filter((w) => /^[a-z]{4,8}$/.test(w)); } catch {}
// сильные слова = старый сленг + отборный список + любимые темы (words_curated.mjs)
const STRONG_ALL = [...new Set([...SLANG, ...CURATED, ...THEMED].map((w) => w.toLowerCase()).filter((w) => /^[a-z0-9]{3,10}$/.test(w)))];
export const WORDS = [...new Set([...STRONG_ALL, ...BIG])];
export const SLANG_SET = new Set(STRONG_ALL);
const MONO = new Set(WORDS.filter((w) => new Set(w).size === 1)); // слова из одного символа (000, 777)
// бакеты по первой букве (чтобы не сканировать весь словарь на каждой позиции)
const WBUCKET = new Map();
for (const w of WORDS) { const c = w[0]; if (!WBUCKET.has(c)) WBUCKET.set(c, []); WBUCKET.get(c).push(w); }

const SEP = (c) => c === '_' || c === '-';
const normCh = (c) => { if (c >= 'A' && c <= 'Z') c = c.toLowerCase(); if (c === '-') c = '_'; return c; };
const norm = (s) => [...s].map(normCh).join('');

// Оценка адреса (uq, 48 символов). Возвращает {score, label, reasons, notable}.
export function scoreGem(uq) {
  const raw = uq;               // как есть (регистр важен для серий/чистоты)
  const n = norm(uq);           // для поиска слов (регистр не важен, - == _)
  let score = 0; const reasons = [];
  let label = null, labScore = -1;
  const setLabel = (l, s) => { if (s > labScore) { labScore = s; label = l; } };

  // --- семейство «повторы»: серия, серия в хвосте, бедный хвост, палиндром ---
  // Это часто ОДИН и тот же факт (…_88888 = серия = хвост = 2 символа = палиндром),
  // поэтому берём лучший признак семейства, а не сумму.
  const rep = []; // {s, why, lab}
  let runBest = 1, runCh = raw[0], i;
  { let c = 1; for (i = 1; i < 48; i++) { if (raw[i] === raw[i - 1]) { c++; if (c > runBest) { runBest = c; runCh = raw[i]; } } else c = 1; } }
  if (runBest >= 5) rep.push({ s: [0,0,0,0,0,30,80,150,250][Math.min(runBest, 8)] + Math.max(0, runBest - 8) * 150, why: `серия ${runCh}×${runBest}`, lab: `${runCh}x${runBest}` });
  // серия в конце ценнее: каждый символ в 64 раза реже, лесенка ~×2 на символ
  let endRun = 1; for (i = 47; i > 0 && raw[i] === raw[i - 1]; i--) endRun++;
  if (endRun >= 4) {
    const sepBefore = raw[48 - endRun - 1] === '_' || raw[48 - endRun - 1] === '-';
    rep.push({ s: [0,0,0,0,40,120,220,350,500][Math.min(endRun, 8)] + Math.max(0, endRun - 8) * 200 + (sepBefore ? 20 : 0),
      why: `хвост ${raw[47]}×${endRun}${sepBefore ? ' после разделителя' : ''}`, lab: `end${raw[47]}x${endRun}` });
  }
  for (const win of [8, 6]) {
    const tail = raw.slice(48 - win);
    const u = new Set(tail).size;
    if (u <= 2) { rep.push({ s: 45 + (win - 6) * 5, why: `хвост ${win}: ${u} символа`, lab: `low${u}:${tail}` }); break; }
    if (u <= 3 && win === 8) rep.push({ s: 15, why: 'хвост 8: 3 символа', lab: 'low3' });
  }
  { let best = 0; for (let c = 0; c < 48; c++) { let r = 0; while (c - r >= 0 && c + r < 48 && raw[c - r] === raw[c + r]) r++; best = Math.max(best, 2 * (r - 1) + 1); r = 0; while (c - r >= 0 && c + 1 + r < 48 && raw[c - r] === raw[c + 1 + r]) r++; best = Math.max(best, 2 * r); }
    if (best >= 6) rep.push({ s: best * 7, why: `палиндром ${best}`, lab: `pal${best}` }); }
  if (rep.length) {
    const top = rep.reduce((a, b) => (b.s > a.s ? b : a));
    score += top.s; reasons.push(top.why); setLabel(top.lab, top.s + (top.lab.startsWith('end') ? 5 : 0));
  }

  // --- бедный набор символов во ВСЁМ адресе (почти только несколько символов) ---
  const uAll = new Set(raw.slice(2)).size; // без префикса UQ
  if (uAll <= 22) { const s = Math.max(0, 23 - uAll) * 16; score += s; reasons.push(`всего ${uAll} разных символов в адресе`); setLabel(`palette${uAll}`, s + (uAll <= 18 ? 100 : 0)); }

  // --- восходящая/нисходящая последовательность ---
  { let b = 1, c = 1; for (i = 1; i < 48; i++) { if (raw.charCodeAt(i) === raw.charCodeAt(i - 1) + 1) { c++; if (c > b) b = c; } else c = 1; } if (b >= 5) { score += 30; reasons.push(`последовательность ${b}`); setLabel(`seq${b}`, 35); } }

  // --- слова-ТОКЕНЫ (обособлены) + «растянутые» буквы внутри (swaaag) ---
  const isSep = (c) => c === '_'; // n уже нормализована ('-' -> '_')
  const fuzzyAt = (p, w) => {      // матч слова с допуском повтора каждой буквы; конец или -1
    let i = p, k = 0; const L = w.length;
    while (k < L) { const c = w[k]; let need = 0; while (k < L && w[k] === c) { need++; k++; } let cnt = 0; while (i < 48 && n[i] === c) { cnt++; i++; } if (cnt < need) return -1; }
    return i;
  };
  // собираем обособленные токены-слова (один на позицию — самый длинный)
  const byPos = new Map();
  for (let p = 0; p < 48; p++) {
    const bucket = WBUCKET.get(n[p]); if (!bucket) continue;
    for (const w of bucket) {
      if (MONO.has(w)) continue;               // 000/777/888 — это серия, её уже оценило семейство «повторы»
      const e = fuzzyAt(p, w); if (e < 0) continue;
      const lb = p === 0 || isSep(n[p - 1]);
      const rb = e === 48 || isSep(n[e]);
      if (!(lb && rb)) continue;
      const span = raw.slice(p, e);
      const letters = [...span].filter((c) => /[a-z]/i.test(c));
      const clean = letters.length > 0 && (letters.every((c) => c === c.toLowerCase()) || letters.every((c) => c === c.toUpperCase()));
      const t = { w, p, end: e, base: w.length, matched: e - p, stretched: e - p > w.length, clean, span };
      const ex = byPos.get(p); if (!ex || t.matched > ex.matched) byPos.set(p, t);
    }
  }
  // убираем перекрытия (жадно слева направо)
  const words = []; let lastEnd = -1;
  for (const t of [...byPos.values()].sort((a, b) => a.p - b.p)) { if (t.p >= lastEnd) { words.push(t); lastEnd = t.end; } }

  if (words.length >= 2) {                      // минимум ДВА слова
    let wsum = 0, covered = 0;
    for (const t of words) { let s = 10 + t.base * 4; if (t.clean) s += 8; if (t.stretched) s += 12 + (t.matched - t.base) * 10; wsum += s; covered += t.matched; }
    // цепочки «слово_слово_слово» (подряд через один разделитель)
    const chains = []; let cur = 1;
    for (let k = 1; k < words.length; k++) { if (words[k - 1].end < 48 && n[words[k - 1].end] === '_' && words[k].p === words[k - 1].end + 1) cur++; else { chains.push(cur); cur = 1; } }
    chains.push(cur);
    const maxChain = Math.max(...chains);
    const wc = words.length, coverFrac = covered / 46;
    let s = wsum + (wc - 1) * 55;                 // больше слов — лучше
    if (maxChain >= 2) s += 130 * (maxChain - 1); // фраза подряд (ценнее растяжек)
    if (coverFrac >= 0.5) s += Math.round((coverFrac - 0.5) * 400);
    let tier = 'words';
    if (maxChain >= 3 || wc >= 4 || coverFrac >= 0.6) { s += 200; tier = 'ultra'; }  // 3+ подряд / 4+ слов / почти весь из слов
    else if (maxChain >= 2) tier = 'phrase';
    score += s;
    const names = words.map((t) => t.w);
    const lbl = (tier === 'ultra' ? 'ultra:' : tier === 'phrase' ? 'phrase:' : 'words:') + names.slice(0, 4).join('_');
    reasons.push(`${wc} слов${maxChain >= 2 ? `, фраза x${maxChain}` : ''}${coverFrac >= 0.5 ? `, покрытие ${Math.round(coverFrac * 100)}%` : ''}: ${names.join(' ')}`);
    setLabel(lbl, s + (tier === 'ultra' ? 400 : tier === 'phrase' ? 200 : 0));
  } else if (words.length === 1) {
    // исключение для одиночного слова: только если РАСТЯНУТО и обособлено разделителем слева
    const t = words[0];
    if (t.matched - t.base >= 2 && t.p > 0 && isSep(n[t.p - 1]) && SLANG_SET.has(t.w)) {
      const extra = t.matched - t.base; const atEnd = t.end === 48;
      let s = 20 + t.base * 4 + extra * 16 + (atEnd ? 20 : 0) + (t.clean ? 10 : 0);
      if (extra >= 2 && atEnd) s += 120;              // сильное растяжение в конце — выше скор (но не «ультра»-метка)
      score += s;
      reasons.push(`растянутое слово ${t.span} (${t.w}, +${extra})${atEnd ? ' в конце' : ''}`);
      setLabel(`stretch:${t.span}`, s);
    }
  }

  const notable = score >= 30;
  if (!label) { label = 'gem'; }
  return { score, label, reasons, notable };
}

// Экспорт словаря в заголовок C для ядра (сортировка по 1-й букве + бакеты).
export function writeWordsHeader() {
  const words = [...WORDS].filter((w) => /^[a-z0-9]{3,8}$/.test(w)).sort((a, b) => a.charCodeAt(0) - b.charCodeAt(0) || (a < b ? -1 : 1));
  const NW = words.length, MAXL = Math.max(...words.map((w) => w.length));
  const BSTART = new Array(128).fill(0), BLEN = new Array(128).fill(0);
  for (let i = 0; i < words.length; i++) { const c = words[i].charCodeAt(0); if (BLEN[c] === 0) BSTART[c] = i; BLEN[c]++; }
  let h = `// auto-generated из src/gems.mjs — словарь для GPU (бакеты по 1-й букве)\n#define NW ${NW}\n#define WMAXL ${MAXL + 1}\n`;
  h += `__device__ char DICT[NW][WMAXL] = {\n` + words.map((w) => `"${w}"`).join(',') + '\n};\n';
  h += `__device__ int DLEN[NW] = {${words.map((w) => w.length).join(',')}};\n`;
  h += `__device__ int BSTART[128] = {${BSTART.join(',')}};\n`;
  h += `__device__ int BLEN[128] = {${BLEN.join(',')}};\n`;
  h += `__device__ unsigned char IS_SLANG[NW] = {${words.map((w) => (SLANG_SET.has(w) ? 1 : 0)).join(',')}};\n`;
  fs.writeFileSync(path.join(__dirname, '..', 'cuda', 'words.h'), h);
  return { NW, MAXL };
}
