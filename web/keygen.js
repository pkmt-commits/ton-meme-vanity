// Быстрая генерация ключей ed25519 в браузере (и в Node для проверки) на низкоуровневых функциях tweetnacl.
// Тот же приём, что в CUDA-ядре: таблица кратных базовой точки с окном 8 бит в аффинной форме (y+x, y−x, 2dxy) —
// 32 смешанных сложения (по 7 умножений) на ключ вместо полного умножения, и одно обращение в поле на пачку ключей
// (трюк Монтгомери). Ключ — обычный 32-байтный сид ed25519: pubkey = зажатые SHA-512(seed)[0..32] · B, как у
// @ton/crypto keyPairFromSeed, поэтому кошелёк импортируется по сиду.
// Подключается как обычный скрипт после nacl-fast.js: определяет глобальный makeKeygen(nacl).
function makeKeygen(nacl) {
  const L = nacl.lowlevel;
  const gf = L.gf, M = L.M, A = L.A, S = L.S, Z = L.Z, add = L.add, set25519 = L.set25519, pack25519 = L.pack25519;
  const gf0 = gf(), gf1 = gf([1]);
  const cp = (p) => [gf(p[0]), gf(p[1]), gf(p[2]), gf(p[3])];
  const D2 = gf(); A(D2, L.D, L.D);
  function inv(o, z) {   // z^(p-2), как inv25519 в tweetnacl
    const c = gf(z);
    for (let a = 253; a >= 0; a--) { S(c, c); if (a !== 2 && a !== 4) M(c, c, z); }
    set25519(o, c);
  }
  // базовая точка B (константы tweetnacl)
  const X = gf([0xd51a, 0x8f25, 0x2d60, 0xc956, 0xa7b2, 0x9525, 0xc760, 0x692c, 0xdc5c, 0xfdd6, 0xe231, 0xc0a4, 0x53fe, 0xcd6e, 0x36d3, 0x2169]);
  const Y = gf([0x6658, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666]);
  const B = [gf(X), gf(Y), gf(gf1), gf()]; M(B[3], X, Y);
  // таблица (проективная) → аффинная форма Нильса одним обращением на всю таблицу
  const proj = []; let base = cp(B);
  for (let i = 0; i < 32; i++) {
    const cur = cp(base);
    for (let j = 0; j < 128; j++) { proj.push(cp(cur)); add(cur, base); }
    for (let k = 0; k < 8; k++) add(base, cp(base));   // base ← 256·base
  }
  const N = proj.length, pre = new Array(N);
  let acc = gf(gf1);
  for (let k = 0; k < N; k++) { const t = gf(); M(t, acc, proj[k][2]); acc = t; pre[k] = acc; }
  let iv = gf(); inv(iv, acc);
  const TQ = new Array(N);   // [y+x, y−x, 2d·x·y]
  for (let k = N - 1; k >= 0; k--) {
    const zi = gf(); if (k) M(zi, iv, pre[k - 1]); else set25519(zi, iv);
    const t = gf(); M(t, iv, proj[k][2]); iv = t;
    const x = gf(), y = gf(); M(x, proj[k][0], zi); M(y, proj[k][1], zi);
    const ypx = gf(), ymx = gf(), xy2d = gf(); A(ypx, y, x); Z(ymx, y, x); M(xy2d, x, y); M(xy2d, xy2d, D2);
    TQ[k] = [ypx, ymx, xy2d];
  }
  // смешанное сложение p += q (q аффинная Нильса); neg — вычесть q. Временные массивы — заранее
  const YpX = gf(), YmX = gf(), qa = gf(), qb = gf(), qc = gf(), qd = gf(), rX = gf(), rY = gf(), rZ = gf(), rT = gf(), nq = gf();
  function madd(p, q, neg) {
    A(YpX, p[1], p[0]); Z(YmX, p[1], p[0]);
    if (!neg) { M(qa, YpX, q[0]); M(qb, YmX, q[1]); M(qc, q[2], p[3]); }
    else { M(qa, YpX, q[1]); M(qb, YmX, q[0]); Z(nq, gf0, q[2]); M(qc, nq, p[3]); }
    A(qd, p[2], p[2]);
    Z(rX, qa, qb); A(rY, qa, qb); A(rZ, qd, qc); Z(rT, qd, qc);
    M(p[0], rX, rT); M(p[1], rY, rZ); M(p[2], rZ, rT); M(p[3], rX, rY);
  }
  const h = new Uint8Array(64), e = new Int16Array(32), tmpB = new Uint8Array(32);
  let P = [], Zp = [];
  const zi = gf(), x = gf(), y = gf(), t = gf();
  // n сидов (Uint8Array(32·n)) → n публичных ключей (Uint8Array(32·n))
  return function pubkeys(seeds, n) {
    while (P.length < n) { P.push([gf(), gf(), gf(), gf()]); Zp.push(gf()); }
    const out = new Uint8Array(32 * n);
    for (let k = 0; k < n; k++) {
      L.crypto_hash(h, seeds.subarray(32 * k, 32 * k + 32), 32);
      h[0] &= 248; h[31] &= 127; h[31] |= 64;
      let carry = 0;
      for (let i = 0; i < 31; i++) { const v = h[i] + carry; carry = (v + 128) >> 8; e[i] = v - (carry << 8); }
      e[31] = h[31] + carry;   // старшая цифра 64..128 (после зажима), без переноса дальше: в таблице есть 128·256^31·B
      const p = P[k]; set25519(p[0], gf0); set25519(p[1], gf1); set25519(p[2], gf1); set25519(p[3], gf0);
      for (let i = 0; i < 32; i++) { const d = e[i]; if (d > 0) madd(p, TQ[128 * i + d - 1], false); else if (d < 0) madd(p, TQ[128 * i - d - 1], true); }
      if (k) M(Zp[k], Zp[k - 1], p[2]); else set25519(Zp[0], p[2]);
    }
    const ivk = gf(); inv(ivk, Zp[n - 1]);
    for (let k = n - 1; k >= 0; k--) {
      if (k) M(zi, ivk, Zp[k - 1]); else set25519(zi, ivk);
      if (k) { M(t, ivk, P[k][2]); set25519(ivk, t); }
      M(x, P[k][0], zi); M(y, P[k][1], zi);
      pack25519(tmpB, y); out.set(tmpB, 32 * k);
      pack25519(tmpB, x); out[32 * k + 31] ^= (tmpB[0] & 1) << 7;
    }
    return out;
  };
}
if (typeof module !== 'undefined') module.exports = { makeKeygen };
