// The fixed-base table for the kernel (v12): T[i][j] = (j+1)·2^(16·i)·B, i < 16, j < 2^15 — 524,288 points, 60 MB.
// The point format is the same as in base_table.h: (y+x, y−x, 2·d·x·y), each one is 5 "limbs" of 51 bits, u64 little-endian.
// With it the kernel does 16 point additions per key instead of 64 (the cryptography is ~2× faster). The keys and addresses are the same.
//   node cuda/gen_wtable.mjs            → cuda/tbl16.bin (~5 s)
import { ed25519 } from '@noble/curves/ed25519.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 16;
const out = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), `tbl${W}.bin`);
const P = (1n << 255n) - 19n, mod = (a) => ((a % P) + P) % P;
const pw = (b, e) => { let r = 1n; b = mod(b); while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; };
const d = mod(-121665n * pw(121666n, P - 2n));
const N = Math.ceil(255 / W), E = 1 << (W - 1);
const M = (1n << 51n) - 1n;
const buf = Buffer.alloc(N * E * 15 * 8);
const B = ed25519.Point.BASE, ORDER = ed25519.Point.Fn.ORDER;
let o = 0;
for (let i = 0; i < N; i++) {
  const step = B.multiply((1n << BigInt(W * i)) % ORDER);
  const X = [], Y = [], Z = [];
  let cur = step;
  for (let j = 0; j < E; j++) { X.push(cur.X); Y.push(cur.Y); Z.push(cur.Z); cur = cur.add(step); }
  // batch normalization (one inversion per row, Montgomery's trick)
  const pre = []; let acc = 1n; for (const z of Z) { acc = acc * z % P; pre.push(acc); }
  let inv = pw(acc, P - 2n);
  const zi = new Array(E);
  for (let j = E - 1; j >= 0; j--) { zi[j] = j ? inv * pre[j - 1] % P : inv; inv = inv * Z[j] % P; }
  for (let j = 0; j < E; j++) {
    const x = mod(X[j] * zi[j]), y = mod(Y[j] * zi[j]);
    if (j < 2) { // check against noble: (j+1)·2^(16i)·B
      const ref = B.multiply(((BigInt(j + 1) << BigInt(W * i)) % ORDER)).toAffine();
      if (ref.x !== x || ref.y !== y) { console.error(`table check failed (i=${i}, j=${j})`); process.exit(1); }
    }
    for (const v of [mod(y + x), mod(y - x), mod(2n * d % P * (x * y % P))]) {
      let t = v; for (let k = 0; k < 5; k++) { buf.writeBigUInt64LE(t & M, o); o += 8; t >>= 51n; }
    }
  }
}
fs.writeFileSync(out, buf);
console.log(`table ${path.basename(out)}: ${N} × ${E} points, ${(buf.length / 1048576).toFixed(0)} MB`);
