// Быстрый предфильтр оценки v5 для браузера — перенос сита v5-lite из CUDA (cuda/v5lite.inc): разбор хвоста «толкающим»
// способом по обратному индексу словаря (слова, кончающиеся в разобранном месте). Точная scoreV5 стоит ~50 мкс на адрес,
// предфильтр — единицы мкс; точно оцениваются только прошедшие. makeLite(v5) → bits(uq) — приближённые биты хвоста
// (≥ 0) или Infinity, если у адреса есть узор/растяжка (их пусть оценит точная функция).
// v5 = { Z, THEME, VOTES, FUNC2, P5, SLANG_SET } — внутренности score_v5 (вшиваются при сборке страницы).
function makeLite(v5) {
  const { Z, THEME, VOTES, FUNC2, P5, SLANG_SET } = v5;
  const words = [], base = [], bonus = [], flags = [];
  for (const [w, z] of Z) {
    if (!/^[a-z0-9]+$/.test(w) || w.length >= 16) continue;
    const alpha = /^[a-z]+$/.test(w), content = w.length >= 3 || THEME.has(w);
    const funcMul = !content || (FUNC2.has(w) && w.length <= 3);
    let b = THEME.has(w) ? P5.themeBonus : SLANG_SET.has(w) ? P5.strongBonus : 0;
    const vt = VOTES.get(w); if (vt > 0) b += P5.wordLike; else if (vt < 0) b -= P5.wordDislike;
    words.push(w); base.push(P5.bitsPerChar * w.length - (9 - z) * Math.log2(10)); bonus.push(b);
    flags.push((alpha ? 1 : 0) | (funcMul ? 2 : 0) | ((w.length >= P5.minContent || SLANG_SET.has(w)) ? 4 : 0) | ((content && !FUNC2.has(w)) || SLANG_SET.has(w) ? 8 : 0));
  }
  const NW = words.length;
  const kc = (c) => { const x = c.charCodeAt(0); if (x >= 97 && x <= 122) return x - 97; if (x >= 48 && x <= 57) return 26 + x - 48; if (c === '_') return 36; return 37; };
  const KS = 38, SUB = 40, KT = 38 * 39;
  // обратный индекс по трём последним пробежкам; два: буквенные слова (по leet-строке) и с цифрами (по обычной)
  function buildRev(alphaType) {
    const key = new Int32Array(NW).fill(-1), cnt = new Int32Array(KT * SUB + 1);
    for (let w = 0; w < NW; w++) {
      if (((flags[w] & 1) === 1) !== alphaType) continue;
      const r = words[w].split('').reverse().join(''), L = r.length;
      let k = 1; while (k < L && r[k] === r[0]) k++;
      const ka = kc(r[0]) * 39 + (k < L ? kc(r[k]) : KS);
      let sub = 39; if (k < L) { let k2 = k; while (k2 < L && r[k2] === r[k]) k2++; if (k2 < L) sub = kc(r[k2]); }
      key[w] = ka * SUB + sub; cnt[key[w]]++;
    }
    const S = new Int32Array(KT * SUB + 1); let acc = 0;
    for (let k = 0; k < KT * SUB; k++) { S[k] = acc; acc += cnt[k]; } S[KT * SUB] = acc;
    const fill = new Int32Array(KT * SUB), I = new Int32Array(acc);
    for (let w = 0; w < NW; w++) if (key[w] >= 0) I[S[key[w]] + fill[key[w]]++] = w;
    return { S, I };
  }
  const RL = buildRev(true), RD = buildRev(false);
  const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b' };
  const isSep = (c) => c === '-' || c === '_', isDig = (c) => c >= '0' && c <= '9', isUp = (c) => c >= 'A' && c <= 'Z', isLet = (c) => (c >= 'a' && c <= 'z') || isUp(c);
  const caseOf = (b, i, e) => { let nu = 0, nl = 0, first = -1, rest = true;
    for (let k = i; k < e; k++) { const c = b[k]; if (isUp(c)) { if (first < 0) first = 1; else rest = false; nu++; } else if (c >= 'a' && c <= 'z') { if (first < 0) first = 0; nl++; } }
    if (!nu && !nl) return 3; if (!nl) return 0; if (!nu) return 1; return first === 1 && rest ? 2 : 3; };
  const edge = (b, n, pos, cls, left) => { if (pos < 0 || pos >= n || isSep(b[pos])) return 1; const c = b[pos]; if (isDig(c)) return P5.visDigit;
    const up = isUp(c); if (cls === 0) return up ? 0 : P5.visCase; if (cls === 1) return up ? P5.visCase : 0; if (cls === 2) return left ? (up ? 0 : P5.visCamel) : (up ? P5.visCamel : 0); return 0; };
  const extra = (b, n, sp, out, inner) => { if (sp < 0 || sp >= n || !isSep(b[sp])) return 0; if (out >= 0 && out < n && isSep(b[out])) return P5.sepDouble;
    if (out >= 0 && out < n && isLet(b[out]) && isLet(b[inner]) && isUp(b[out]) !== isUp(b[inner])) return P5.sepCase; return 0; };
  function gain(b, n, low, w, i, e) {
    const L = words[w].length, f = flags[w];
    let st = e - i - L; if (st > P5.stretchCap) st = P5.stretchCap;
    let leet = 0; if (f & 1) for (let k = i; k < e; k++) if (isDig(low[k])) leet++;
    let g = base[w] + st * P5.stretchGain - leet * P5.leetCost; if (f & 2) g *= P5.funcK; g += bonus[w];
    const cls = caseOf(b, i, e); let v = (edge(b, n, i - 1, cls, true) + edge(b, n, e, cls, false)) / 2;
    if (cls === 3) v *= P5.visMixed; v += (extra(b, n, i - 1, i - 2, i) + extra(b, n, e, e + 1, e - 1)) / 2;
    return g > 0 ? g * (1 - P5.vis * (1 - v)) : g;
  }
  const shortOk = (b, n, i, e) => (e - i > 2) || ((i === 0 || isSep(b[i - 1]) || isDig(b[i - 1])) && (e === n || isSep(b[e]) || isDig(b[e])));
  const sg = new Float64Array(47), snw = new Int32Array(47), sfl = new Int32Array(47);
  return function bits(uq) {
    const b = uq.slice(2), n = 46;
    // узоры и растяжки — сразу к точной оценке (редкость)
    let run = 1, rb = 1, seps = 0; for (let i = 0; i < n; i++) { if (isSep(b[i])) seps++; if (i && b[i] === b[i - 1]) { if (++run > rb) rb = run; } else run = 1; }
    if (rb >= 4 || seps >= 7) return Infinity;
    const low = b.toLowerCase(), lt = low.replace(/[0134578]/g, (d) => LEET[d]);
    sg.fill(-1e30); sg[n] = 0; snw[n] = 0; sfl[n] = 0;
    for (let e = n; e > 0; e--) {
      if (sg[e] <= -1e29) continue;
      if (isSep(b[e - 1]) || isDig(b[e - 1])) { if (sg[e] > sg[e - 1]) { sg[e - 1] = sg[e]; snw[e - 1] = snw[e]; sfl[e - 1] = sfl[e] & ~4; } }
      if (!(e === n || isSep(b[e]) || isDig(b[e]) || (sfl[e] & 4))) continue;
      for (let t = 0; t < 2; t++) {
        const X = t === 0 ? lt : low, R = t === 0 ? RL : RD;
        const c0 = kc(X[e - 1]); let q = e - 1; while (q >= 0 && X[q] === X[e - 1]) q--;
        const c1 = q >= 0 ? kc(X[q]) : 37; let c2 = 38; if (q >= 0) { let r = q; while (r >= 0 && X[r] === X[q]) r--; if (r >= 0) c2 = kc(X[r]); }
        const ka = (c0 * 39 + c1) * SUB, kb = (c0 * 39 + KS) * SUB + 39;
        const lists = [[c2 < 38 ? R.S[ka + c2] : 0, c2 < 38 ? R.S[ka + c2 + 1] : 0], [R.S[ka + 39], R.S[ka + 40]], [R.S[kb], R.S[kb + 1]]];
        for (const [x0, x1] of lists) for (let x = x0; x < x1; x++) {
          const w = R.I[x], wd = words[w], L = wd.length;
          // совпадение слова, кончающегося в e: последняя/внутренние пробежки целиком, первая — частично
          let p = e - 1, k = L - 1, iMin = -1, iMax = -1;
          while (k >= 0) { const c = wd[k]; let need = 0; while (k >= 0 && wd[k] === c) { need++; k--; }
            let cnt = 0; while (p >= 0 && X[p] === c) { cnt++; p--; }
            if (cnt < need) { iMin = -1; break; } if (k < 0) { iMin = p + 1; iMax = p + 1 + cnt - need; } }
          if (iMin < 0) continue;
          for (let i = iMin; i <= iMax; i++) {
            if (t === 0) { if (isDig(low[i])) continue; let d = 0; for (let m = i; m < e; m++) if (isDig(low[m])) d++; if (d > (L >= 6 ? 2 : 1)) continue; }
            if (L <= 2 && !shortOk(b, n, i, e)) continue;
            const cg = sg[e] + gain(b, n, low, w, i, e);
            if (cg > sg[i]) { sg[i] = cg; snw[i] = snw[e] + 1; sfl[i] = (sfl[e] & 2) | 1 | 4 | ((flags[w] & 4) ? 2 : 0); }
          }
        }
      }
    }
    let best = 0;
    for (let i = 0; i < n; i++) {
      if (sg[i] <= 0 || !(sfl[i] & 2)) continue;
      if (i > 0 && !isSep(b[i - 1]) && !isDig(b[i - 1]) && !(isLet(b[i - 1]) && isLet(b[i]) && isUp(b[i - 1]) !== isUp(b[i]))) continue;
      if (sg[i] > best) best = sg[i];
    }
    return best;
  };
}
if (typeof module !== 'undefined') module.exports = { makeLite };
