// Оценка v5 (2026-10-04) = v4 + обособленность слов, сильная концовка, слабое 3-буквенное начало, вес серий.
// Веса P5 подогнаны под попарные предпочтения автора (Брэдли–Терри). Ниже — описание v4, оно в силе.
// Оценка v4 — «насколько кусок адреса менее случаен, чем шум», в битах.
// Идея из сегментации текста (wordninja) и детекторов DGA: лучшее разбиение на слова по частотности.
//   цена слова  = -log2 P(слово)        (P из wordfreq, data/en_zipf.tsv; zipf = log10 на млрд слов)
//   шум         = 5 бит на символ       (буква без учёта регистра = 2 из 64)
//   выигрыш     = 5*длина - цена         (>0 — слово «неслучайно»)
// Частые короткие слова (of, to, my) дешёвые: сами по себе почти ничего не дают, но склеивают фразу.
// Любимые темы — минимальная частота + бонус. Ценится фраза в КОНЦЕ, начало сразу после UQ, 3+ слова.
import fs from 'node:fs';
import { SLANG_SET } from './gems.mjs';
import { THEMED } from './words_curated.mjs';

export const P5 = {
  bitsPerChar: 5, minZipf: 2.5, themeFloor: 5.0, strongFloor: 4.2,
  themeBonus: 4, strongBonus: 3, funcK: 0.5, connector: 3, glue: 0,
  stretchGain: 1, stretchCap: 3, leetCost: 4, extraWord: 0, startK: 0.4, bookend: 0, startAD: 3, singleK: 0.7,
  startTheme: 8, digitToFor: 1.5, digitSep: 3, face: 6,
  minContent: 4, second: 0.3,
  // v5: склейка со сменой регистра (в v4 бесплатно), обособленность (разделитель/край с обеих сторон),
  // сильное последнее слово, голое 3-буквенное начало, множитель серий/повторов
  glueCase: 0, iso: 0, lastStrong: 0, start3: 8, repK: 0.3,
  // заметность слова (см. withVis); vis 0 = выключено
  vis: 0.7, visDigit: 0.6, visCase: 0.8, visMixed: 0.75,
  // растянутое слово где угодно (Swwwwwwag в середине бросается в глаза лучше многих концовок)
  midRun: 4, midBase: 0, midStretch: 4, midVis: 0.35, midStart: 6, midMixed: 0.6,
  // сила обособления разная — двойной разделитель (abc--WORD) и
  // «строчная+разделитель+Заглавная» (x-Word) ярче одинарного; CamelCase (MuchWow) — полноценная граница;
  // хорошее 3-буквенное начало на контрасте (UQBUMx…) не штрафуем как голое
  sepDouble: 0.25, sepCase: 0.15, visCamel: 1, start3Vis: 0.25,
  // оценки слов автором (data/word_votes.json, необязательный файл): 👍 +wordLike бит, 👎 −wordDislike бит
  wordLike: 4, wordDislike: 6,
};
// слова, которых нет/мало в частотном словаре: только в Node-оценке (GPU-словарь не трогаем)
const EXTRA_THEME = ['lowk', 'lowkey', 'mill', 'million',
  // TON/крипто/зумер-сленг (≥4 букв)
  ...`durov durev freedurov notcoin hamster taptap toncoin gram grams jetton plush plushpepe durovcap peach snoopdogg swagbag claim eligible snapshot listing sybil sendit cooking copium hopium bagholder exitscam honeypot shitcoin memecoin altseason bullish bearish btfd buythedip liquidated safu hfsp staypoor itsover wereback brrr printer stonks tendies yolo cabal gigabrain pumpfun fartcoin dogwifhat moodeng chillguy hawktuah satoshi normie mfer jpeg tothemoon saylor vitalik elon cramer trump vibecode rizz rizzler skibidi sigma gyatt mewing aura aurafarm delulu slay bussin cooked ratio goat sixseven lowkey clanker chopped fanumtax ohio brainrot yeet bruh frfr deadass sheesh simp looksmax mogged skillissue touchgrass tungtung tralalero labubu lmao lmfao rofl kekw noob pwned ggwp poggers resistance resistancedog`.split(' ')];
const EXTRA_WORD = ['bum'];   // просто слова (3 буквы с zipf < 3.5 иначе выкидываются), без бонуса темы
const FUNC2 = new Set('a i of to in on at by my me we us up go no so is it be do an or if as he oh ok hi yo gm gn ya am the and for not you are was all his her our out new big hot top fat bad mad sad'.split(' '));

// словарь: слово -> zipf
const Z = new Map();
for (const line of fs.readFileSync(new URL('../data/en_zipf.tsv', import.meta.url), 'utf8').split('\n')) {
  const [w, z] = line.split('\t'); if (!w) continue;
  const zz = Number(z);
  if (w.length <= 2 && !FUNC2.has(w)) continue;          // мусорные 1-2 буквенные (ll, ve, th)
  if (w.length === 3 && zz < 3.5 && !SLANG_SET.has(w)) continue;
  if (zz >= P5.minZipf) Z.set(w, zz);
}
const THEME = new Set(THEMED.map((w) => w.toLowerCase()));
// оценки слов автором ({слово: 1|0|-1}); файла нет — оценок нет
const VOTES = new Map();
try { for (const [w, r] of Object.entries(JSON.parse(fs.readFileSync(new URL('../data/word_votes.json', import.meta.url), 'utf8')))) VOTES.set(w, r); } catch {}
for (const w of SLANG_SET) if (/^[a-z0-9]+$/.test(w) && new Set(w).size > 1) Z.set(w, Math.max(Z.get(w) ?? 0, THEME.has(w) ? P5.themeFloor : P5.strongFloor));
for (const w of THEME) if (/^[a-z0-9]+$/.test(w) && new Set(w).size > 1) Z.set(w, Math.max(Z.get(w) ?? 0, P5.themeFloor));
for (const w of EXTRA_THEME) { Z.set(w, Math.max(Z.get(w) ?? 0, P5.themeFloor)); THEME.add(w); }
for (const w of EXTRA_WORD) Z.set(w, Math.max(Z.get(w) ?? 0, 3.6));
for (const w of ['uwu', 'owo', 'xd']) Z.delete(w);         // смайлы — не слова, их считает линза смайлов (иначе двойной счёт)

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b' };
const isDig = (c) => c >= '0' && c <= '9';
const isSep = (c) => c === '-' || c === '_';

const mk = (pred) => { const r = {}; for (const [w] of Z) if (pred(w)) { let n = r; for (const c of w) n = n[c] ??= {}; n.$ = w; } return r; };
const TL = mk((w) => /^[a-z]+$/.test(w));
const TD = mk((w) => /\d/.test(w));

function wordInfo(w, span) {
  const z = Z.get(w);
  const cost = (9 - z) * Math.log2(10);
  const stretch = Math.min(span.length - w.length, P5.stretchCap);
  const leetN = /^[a-z]+$/.test(w) ? (span.match(/\d/g) || []).length : 0;
  let gain = P5.bitsPerChar * w.length - cost + stretch * P5.stretchGain - leetN * P5.leetCost;
  const content = w.length >= 3 || THEME.has(w);
  if (!content || (FUNC2.has(w) && w.length <= 3)) gain *= P5.funcK;
  if (THEME.has(w)) gain += P5.themeBonus; else if (SLANG_SET.has(w)) gain += P5.strongBonus;
  const vote = VOTES.get(w); if (vote > 0) gain += P5.wordLike; else if (vote < 0) gain -= P5.wordDislike;
  let dup = 0; for (let k = 1; k < span.length; k++) if (span[k].toLowerCase() === span[k - 1].toLowerCase()) dup++;
  return { w, span, gain, content: content && !FUNC2.has(w) || SLANG_SET.has(w), long: w.length >= P5.minContent || SLANG_SET.has(w), dup };
}

// leet в меру: слово не начинается с цифры, цифр-букв не больше 1 (короткое) / 2 (от 6 букв)
function leetOk(low, i, j, w) {
  if (isDig(low[i])) return false;
  let d = 0; for (let k = i; k < j; k++) if (isDig(low[k])) d++;
  return d <= (w.length >= 6 ? 2 : 1);
}

// слова, начинающиеся в i (с растяжкой); low — нижний регистр, lt — leet-версия
function wordsAt(low, lt, i) {
  const out = [];
  for (const [s, root] of [[lt, TL], [low, TD]]) {
    const st = [[i, root, '']];
    while (st.length) {
      const [j, n, last] = st.pop();
      if (n.$ && j > i && (root === TD || leetOk(low, i, j, n.$))) out.push({ w: n.$, i, e: j });
      if (j >= s.length) continue;
      const c = s[j];
      if (c === last) st.push([j + 1, n, last]);
      if (n[c]) st.push([j + 1, n[c], c]);
    }
  }
  return out;
}

// заметность слова глазами: слово, слипшееся с мусором, почти не читается.
// Граница с каждой стороны: край или -/_ = 1; контраст регистра у однородного слова = visCase (xyzHOMEabc, XYZhomeABC,
// abcHome); цифра = visDigit; буква без контраста = 0. Слово с рваным регистром (jUmMPp) контраста не даёт и ещё ×visMixed.
// Ценность слова ×(1 − vis·(1 − заметность)): при vis 0.7 незаметное слово стоит 30%.
const caseOf = (span) => {
  const L = span.replace(/[^A-Za-z]/g, '');
  if (!L || L === L.toUpperCase()) return L ? 'U' : 'M';
  if (L === L.toLowerCase()) return 'L';
  return L[0] === L[0].toUpperCase() && L.slice(1) === L.slice(1).toLowerCase() ? 'C' : 'M';
};
function edgeVis(c, cls, left) {
  if (c === undefined || isSep(c)) return 1;
  if (isDig(c)) return P5.visDigit;
  const up = c >= 'A' && c <= 'Z';
  if (cls === 'U') return up ? 0 : P5.visCase;
  if (cls === 'L') return up ? P5.visCase : 0;
  if (cls === 'C') return left ? (up ? 0 : P5.visCamel) : (up ? P5.visCamel : 0);
  return 0;
}
function withVis(wi, s, i, e) {
  const cls = caseOf(s.slice(i, e));
  let v = (edgeVis(s[i - 1], cls, true) + edgeVis(s[e], cls, false)) / 2;
  if (cls === 'M') v *= P5.visMixed;
  // обособление сильнее обычного: двойной разделитель или смена регистра через разделитель (x-Word, WORD_x)
  const extra = (sep, out, inner) => (!isSep(sep) ? 0 : isSep(out) ? P5.sepDouble
    : /[A-Za-z]/.test(out || '') && /[A-Za-z]/.test(inner || '') && (out <= 'Z') !== (inner <= 'Z') ? P5.sepCase : 0);
  v += (extra(s[i - 1], s[i - 2], s[i]) + extra(s[e], s[e + 1], s[e - 1])) / 2;
  const k = 1 - P5.vis * (1 - v);
  return { ...wi, i, e, vis: v, gain: wi.gain > 0 ? wi.gain * k : wi.gain };
}

// можно ли склеить два слова без разделителя (wordninja-стиль): штраф, если нет смены регистра
const glueCost = (raw, j) => (/[a-z]/.test(raw[j - 1]) !== /[a-z]/.test(raw[j]) ? P5.glueCase : P5.glue);
// короткие (1-2 буквы, предлоги) — только отдельным куском: с обеих сторон разделитель/цифра/край
const shortOk = (body, i, e) => (e - i > 2) || ((i === 0 || isSep(body[i - 1]) || isDig(body[i - 1])) && (e === body.length || isSep(body[e]) || isDig(body[e])));

// цифра как разделитель: 2 = to, 4 = for — плюс; 0 нейтрален;
// одна и та же цифра, повторённая как разделитель, читается разделителем; прочие одиночные — штраф
function digitSepAdj(body) {
  const adj = new Array(body.length).fill(0), cnt = {};
  for (const c of body) if (isDig(c)) cnt[c] = (cnt[c] || 0) + 1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]; if (!isDig(c)) continue;
    const lone = !isDig(body[i - 1] || '') && !isDig(body[i + 1] || '');
    if (c === '0') adj[i] = 0;
    else if ((c === '2' || c === '4') && lone) adj[i] = P5.digitToFor;
    else if (cnt[c] >= 2) adj[i] = 0;
    else adj[i] = -P5.digitSep;
  }
  return adj;
}

// лучшая полная разметка отрезков: suffix — от i до конца; prefix — от 0 до j
function analyze(body) {
  const N = body.length, low = body.toLowerCase(), lt = low.replace(/[0134578]/g, (d) => LEET[d]);
  const dAdj = digitSepAdj(body);
  const at = Array.from({ length: N }, (_, i) => wordsAt(low, lt, i).filter((m) => m.w.length > 2 || shortOk(body, m.i, m.e)));
  // суффиксный DP: suf[i] = лучший разбор body[i..N) без мусора
  const suf = new Array(N + 1).fill(null); suf[N] = { g: 0, words: [], prevWord: false };
  for (let i = N - 1; i >= 0; i--) {
    let best = null; const take = (c) => { if (c && (!best || c.g > best.g)) best = c; };
    if ((isSep(body[i]) || isDig(body[i])) && suf[i + 1]) take({ g: suf[i + 1].g + (suf[i + 1].words.length ? dAdj[i] : 0), words: suf[i + 1].words, prevWord: false });
    for (const m of at[i]) {
      const nx = suf[m.e]; if (!nx) continue;
      if (m.e < N && !isSep(body[m.e]) && !isDig(body[m.e]) && !nx.prevWord) continue;
      const wi = withVis(wordInfo(m.w, body.slice(m.i, m.e)), body, m.i, m.e);
      const glue = m.e < N && nx.prevWord && !isSep(body[m.e]) && !isDig(body[m.e]) ? glueCost(body, m.e) : 0;
      take({ g: nx.g + wi.gain - glue, words: [wi, ...nx.words], prevWord: true });
    }
    suf[i] = best;
  }
  // префиксный DP: pre[j] = лучший разбор body[0..j)
  const pre = new Array(N + 1).fill(null); pre[0] = { g: 0, words: [], lastWord: false };
  for (let i = 0; i < N; i++) {
    const cur = pre[i]; if (!cur) continue;
    const put = (j, c) => { if (!pre[j] || c.g > pre[j].g) pre[j] = c; };
    if (isSep(body[i]) || isDig(body[i])) put(i + 1, { g: cur.g + (cur.words.length ? dAdj[i] : 0), words: cur.words, lastWord: false });
    for (const m of at[i]) {
      if (cur.lastWord && i > 0 && !isSep(body[i - 1]) && !isDig(body[i - 1])) { /* склейка */ }
      const wi = withVis(wordInfo(m.w, body.slice(m.i, m.e)), body, m.i, m.e);
      const glue = cur.lastWord ? glueCost(body, i) : 0;
      put(m.e, { g: cur.g + wi.gain - glue, words: [...cur.words, wi], lastWord: true });
    }
  }
  return { suf, pre, N };
}

const okPhrase = (p) => p && p.words.some((w) => w.long) && p.g > 0;
// граница фразы по регистру между s[j-1] и s[j] (две буквы разного регистра) — как на GPU с v8 (2026-10-04);
// насколько слово при этом заметно, решает withVis (контраст должен соответствовать регистру самого слова)
const caseCut = (s, j) => { const a = s[j - 1], b = s[j]; return /[A-Za-z]/.test(a) && /[A-Za-z]/.test(b) && (a <= 'Z') !== (b <= 'Z'); };
// обособленность слова: край или разделитель — 1, цифра — 0.5, буква — 0 (среднее по двум сторонам)
const bnd = (c) => (c === undefined || isSep(c) ? 1 : isDig(c) ? 0.5 : 0);
const isoSum = (s, words) => words.filter((w) => w.content || w.long).reduce((t, w) => t + (bnd(s[w.i - 1]) + bnd(s[w.e])) / 2, 0);

// --- «линзы» неслучайности ---
// без XD/xD: двухбуквенное слишком часто ловится в случайном мусоре
const FACES = ['-_-', 'o_O', 'O_o', 'o_o', 'O_O', '0_0', 'x_x', 'X_X', 'T_T', 'u_u', 'U_U', 'e_e', 'UwU', 'OwO', 'uwu', 'owo', 'q_q', 'v_v', 'n_n'];
const isLow = (c) => c >= 'a' && c <= 'z', isUp = (c) => c >= 'A' && c <= 'Z';
// контраст: соседний символ не «сливается» с краем лица (та же категория: строчная/заглавная/цифра/разделитель)
const cat = (c) => (c === undefined ? 'edge' : isLow(c) ? 'lo' : isUp(c) ? 'up' : isDig(c) ? 'dig' : 'sep');
function findFaces(body) {
  const out = [];
  for (const f of FACES) {
    let p = body.indexOf(f);
    while (p >= 0) {
      const l = body[p - 1], r = body[p + f.length];
      if (cat(l) !== cat(f[0]) && cat(r) !== cat(f.at(-1))) { out.push(f); break; }
      p = body.indexOf(f, p + 1);
    }
  }
  return out;
}
const MEMNUM = [['69420', 14], ['80085', 16], ['5318008', 12], ['100500', 9], ['1337', 14], ['420', 10], ['228', 6], ['322', 6], ['69', 3], ['67', 3], ['777', 4], ['666', 4]];
// сразу после UQ: серия одного символа (UQAAAAA) или лесенка (UQABCDE / UQ1234)
function startPattern(body) {
  let k = 1; while (k < body.length && body[k] === body[0]) k++;
  let a = 1; while (a < body.length && body.charCodeAt(a) === body.charCodeAt(a - 1) + 1) a++;
  const best = Math.max(k, a);
  if (best < 4) return null;
  return { k: best, b: (best - 3) * 6, why: k >= a ? `UQ+${body[0]}×${k}` : `UQ+лесенка ${body.slice(0, a)}` };
}

// растянутое слово в любом месте: внутри слова одна буква повторена ≥ midRun раз подряд (точный регистр).
// Растяжка сама выделяет слово из мусора, поэтому разделители не нужны; заметность по краям влияет слабо (midVis).
// Ценность = выигрыш слова (с обычной растяжкой ≤ stretchCap) + midBase + midStretch за каждую букву растяжки сверх stretchCap.
// Если слово уже входит в хвост/начало — фраза его посчитала, добавляется только надбавка за растяжку сверх stretchCap (long).
function stretchedWords(body) {
  const low = body.toLowerCase(), out = [];
  for (let i = 0; i < body.length; i++) for (const m of wordsAt(low, low, i)) {
    if (!/^[a-z]+$/.test(m.w) || m.w.length < 3) continue;
    const span = body.slice(m.i, m.e);
    let run = 1, rb = 1; for (let k = 1; k < span.length; k++) { if (span[k] === span[k - 1]) rb = Math.max(rb, ++run); else run = 1; }
    if (rb < P5.midRun) continue;
    const wi = wordInfo(m.w, span);
    if (!wi.content || wi.gain <= 0) continue;
    const v = withVis(wi, body, m.i, m.e).vis;
    const long = P5.midStretch * Math.max(0, rb - 1 - P5.stretchCap);   // по самой длинной серии, а не по сумме (BIIRRRRD — не растяжка ×6)
    // сразу после UQ (или UQx-) — ещё и мемное начало (UQAGOOOOOOD)
    const atStart = m.i === 0 || (m.i === 2 && isSep(body[1])) || (m.i === 1 && /[A-D]/.test(body[0]) && body[0].toLowerCase() !== m.w[0]);
    // m.i === 0: первая буква — 3-й символ адреса (всегда A-D), достаётся почти даром; рваный регистр (BBBBbbIll) ×midMixed
    let b = (wi.gain + P5.midBase + long + (atStart ? P5.midStart : 0) - (m.i === 0 ? P5.startAD : 0)) * (1 - P5.midVis * (1 - v));
    if (caseOf(span) === 'M') b *= P5.midMixed;
    out.push({ b, long, w: m.w, span, run: rb, i: m.i, e: m.e, atStart });
  }
  return out.sort((a, b) => b.b - a.b);
}

function bestTail(body, suf, N, k) {
  let tail = null, tailStart = N;
  for (let i = 0; i < N; i++) {
    const p = suf[i]; if (!okPhrase(p)) continue;
    if (i > 0 && !isSep(body[i - 1]) && !isDig(body[i - 1]) && !caseCut(body, i)) continue;
    if (!tail || p.g * k > tail.g) { tail = { ...p, g: p.g * k }; tailStart = i; }
  }
  return { tail, tailStart };
}

export function scoreV5(uq) {
  const body = uq.slice(2);
  const { suf, pre, N } = analyze(body);
  const reasons = [];
  // хвост: лучший суффикс, начинающийся на границе (начало, после разделителя или цифры)
  let { tail, tailStart } = bestTail(body, suf, N, 1);
  // …или почти хвост: после фразы 1-2 мусорных символа, отделённых разделителем/цифрой (BEER_x7)
  for (const cut of [1, 2]) {
    const c = N - cut; if (!(isSep(body[c - 1]) || isDig(body[c - 1]) || isSep(body[c]))) continue;
    const a = analyze(body.slice(0, c)); const t = bestTail(body.slice(0, c), a.suf, c, cut === 1 ? 0.7 : 0.55);
    if (t.tail && (!tail || t.tail.g > tail.g)) { tail = t.tail; tailStart = t.tailStart; tail.cut = cut; }
  }
  // начало: лучший префикс сразу после UQ (или после «UQx-»), кончающийся на границе и не залезающий в хвост
  let start = null;
  const starts = [{ off: 0, pre }];
  if (isSep(body[1])) starts.push({ off: 2, pre: analyze(body.slice(2)).pre });
  for (const { off, pre: pr } of starts) for (let j = 1; j + off <= Math.min(tailStart, N); j++) {
    const p = pr[j]; if (!okPhrase(p)) continue;
    const J = j + off;
    if (J < N && !isSep(body[J]) && !isDig(body[J]) && !caseCut(body, J)) continue;
    let g = p.g - (off === 0 ? P5.startAD : 0);            // 3-й символ адреса всегда A-D: слово на a-d там почти даром
    if (off === 0 && p.words.some((w) => SLANG_SET.has(w.w))) g += P5.startTheme;  // UQBITCH, UQDEGEN — мемное/ругательное сразу после UQ
    // голое 3-буквенное начало (UQBar8…, UQCAr8…) почти не читается — если это не мемное слово
    if (p.words.length === 1 && p.words[0].w.length <= 3 && !SLANG_SET.has(p.words[0].w)) g -= P5.start3 * (p.words[0].vis >= 0.9 ? P5.start3Vis : 1);
    if (g > 0 && (!start || g > start.g)) start = { ...p, g, off };
  }
  if (tail && tailStart === 0) start = null;               // весь адрес — одна фраза

  const cnt = (p) => (p ? p.words.filter((w) => w.content).length : 0);
  const nT = cnt(tail), nS = cnt(start), nAll = nT + nS;
  const spans = (p) => p.words.map((w) => w.span);

  // редкости для одиночного слова
  let seps = 0; for (const c of body) if (isSep(c)) seps++;
  let run = 1, runBest = 1; for (let i = 1; i < N; i++) { if (body[i] === body[i - 1]) { run++; runBest = Math.max(runBest, run); } else run = 1; }
  const dist = new Set(body).size;
  const combo = [];
  if (tail && tail.words.some((w) => w.dup >= 2 && w.long)) combo.push({ b: 4, why: 'повторы букв' });
  if (seps >= 7) combo.push({ b: 3 + (seps - 7), why: `${seps} разделителей` });
  if (runBest >= 4) combo.push({ b: 3 * (runBest - 3), why: `серия ×${runBest}` });
  if (dist <= 25) combo.push({ b: (26 - dist) * 1.2, why: `${dist} разных символов` });
  // смайлы — только на контрасте с соседями (лицо читается отдельно)
  // один бонус на адрес, сколько бы смайлов ни нашлось
  const faces = findFaces(body);
  if (faces.length) combo.push({ b: P5.face, why: `смайл ${faces.join(' ')}` });
  // мемные числа, стоящие отдельно
  for (const [n, b] of MEMNUM) { const re = new RegExp(`(^|[^0-9])${n}($|[^0-9])`); if (re.test(body)) { combo.push({ b, why: `число ${n}` }); break; } }
  // лесенка / серия сразу после UQ (UQABCDEF, UQAAAAAA)
  const st = startPattern(body);
  if (st) combo.push({ b: st.b, why: st.why });
  const comboB = combo.reduce((x, c) => x + c.b, 0);

  let bits = 0, label = 'gem';
  if (tail && (nAll >= 2 || comboB > 0)) {
    bits = tail.g + Math.max(0, nT - 1) * P5.extraWord;
    if (start) bits += start.g * P5.startK + P5.bookend;
    if (nAll >= 3) bits += P5.extraWord;
    // v5: обособленные слова читаются, прилипшие к мусору — нет; сильное последнее слово — «концовка топ»
    bits += P5.iso * (isoSum(body.slice(0, N - (tail.cut || 0)), tail.words) + (start ? isoSum(body.slice(start.off), start.words) : 0));
    const last = tail.words.at(-1);
    if (!tail.cut && last && SLANG_SET.has(last.w)) bits += P5.lastStrong;
    bits += nAll >= 2 ? comboB * 0.5 : comboB;
    if (nAll < 2) bits *= P5.singleK;                       // одно слово + редкость — ниже фраз
    const tier = nAll >= 3 ? 'T3' : start ? 'TS' : nT >= 2 ? 'T2' : 'T1';
    label = `${tier}:${[...(start ? [...spans(start), '…'] : []), ...spans(tail)].join('_')}`;
    if (start) reasons.push(`начало: ${spans(start).join(' ')}`);
    reasons.push(`хвост: ${spans(tail).join(' ')}`);
    if (combo.length) reasons.push(combo.map((c) => c.why).join(', '));
  }

  // повторы — одна семья (в битах)
  const rep = [];
  let endRun = 1; for (let i = uq.length - 1; i > 0 && uq[i] === uq[i - 1]; i--) endRun++;
  if (endRun >= 5) rep.push({ b: [0, 0, 0, 0, 0, 14, 22, 35, 50][Math.min(endRun, 8)] + Math.max(0, endRun - 8) * 20, why: `хвост ${uq.at(-1)}×${endRun}`, lab: `end${uq.at(-1)}x${endRun}` });
  if (runBest >= 6) rep.push({ b: [0, 0, 0, 0, 0, 0, 8, 15, 25][Math.min(runBest, 8)] + Math.max(0, runBest - 8) * 15, why: `серия ×${runBest}`, lab: `run${runBest}` });
  if (st && st.k >= 5) rep.push({ b: st.b * 1.5, why: st.why, lab: `start:${body.slice(0, st.k)}` });   // «как пример из документации»
  // растянутое слово где угодно — своя семья; серия внутри него — тот же факт, её не считаем
  const sws = stretchedWords(body);
  const startEnd = bits > 0 && start ? start.off + start.words.at(-1).e : -1;
  const inPhrase = (m) => bits > 0 && ((tail && m.i >= tailStart) || m.e <= startEnd);
  const inner = sws.filter(inPhrase).sort((a, b) => b.long - a.long)[0];
  if (inner && inner.long > 0) { bits += inner.long; reasons.push(`растяжка ${inner.span}`); }
  const mid = sws.find((m) => !inPhrase(m));
  const midB = mid ? mid.b : 0;
  if ((mid && mid.run >= runBest) || (inner && inner.long > 0 && inner.run >= runBest)) for (let k = rep.length - 1; k >= 0; k--) if (rep[k].lab.startsWith('run')) rep.splice(k, 1);
  let repB = 0;
  if (rep.length) { const top = rep.reduce((a, b) => (b.b > a.b ? b : a)); repB = top.b * P5.repK; reasons.push(top.why); if (repB > bits) label = top.lab; }
  if (mid) { reasons.push(`растяжка: ${mid.span}`); if (midB > bits && midB > repB) label = `TM:${mid.w}${mid.run}`; }

  const fam = [bits, repB, midB].sort((a, b) => b - a);
  const total = fam[0] + (fam[1] + fam[2]) * P5.second;
  // startG — сила слова сразу после UQ (биты, 0 если нет), startPat — длина узора UQAAAA/UQABCD (для слота «начало» в боте)
  // слова фразы (словарные формы) — для вкладки «Слова» и личных оценок слов
  const words = bits > 0 ? [...(start ? start.words : []), ...(tail ? tail.words : [])].filter((w) => w.content || w.long).map((w) => ({ w: w.w, span: w.span })) : [];
  if (mid) words.push({ w: mid.w, span: mid.span });
  return { score: Math.round(total * 10), label, reasons, nWords: nAll, words, startG: Math.max(bits > 0 && start ? start.g : 0, mid && mid.atStart ? mid.b : 0), startPat: st ? st.k : 0 };
}
