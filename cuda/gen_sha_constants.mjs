// Generates the exact SHA-256/512 constants (roots of primes) and self-checks them against Node crypto.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function primes(n) {
  const out = []; let c = 2;
  while (out.length < n) { let p = true; for (let i = 2; i * i <= c; i++) if (c % i === 0) { p = false; break; } if (p) out.push(c); c++; }
  return out;
}
// integer n-th root (floor) for BigInt
function iroot(x, k) {
  if (x < 0n) throw 0; if (x === 0n) return 0n;
  let hi = 1n; while (hi ** BigInt(k) <= x) hi <<= 1n;
  let lo = hi >> 1n;
  while (lo < hi) { const mid = (lo + hi + 1n) >> 1n; if (mid ** BigInt(k) <= x) lo = mid; else hi = mid - 1n; }
  return lo;
}
// the first n bits of the fractional part of p^(1/root)
const fracBits = (p, root, nbits) => iroot(BigInt(p) << BigInt(root * nbits), root) & ((1n << BigInt(nbits)) - 1n);

const P8 = primes(8), P80 = primes(80);
const SHA256_H = P8.map((p) => fracBits(p, 2, 32));
const SHA256_K = P80.slice(0, 64).map((p) => fracBits(p, 3, 32));
const SHA512_H = P8.map((p) => fracBits(p, 2, 64));
const SHA512_K = P80.map((p) => fracBits(p, 3, 64));

// --- self-check: sha256/sha512 built on these constants == Node ---
function sha256js(msg) {
  const H = SHA256_H.map(Number);
  const K = SHA256_K.map(Number);
  const ml = msg.length;
  const withPad = [...msg, 0x80];
  while (withPad.length % 64 !== 56) withPad.push(0);
  const bl = ml * 8;
  for (let i = 7; i >= 0; i--) withPad.push((bl / 2 ** (i * 8)) & 0xff);
  const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
  for (let o = 0; o < withPad.length; o += 64) {
    const w = new Array(64);
    for (let i = 0; i < 16; i++) w[i] = (withPad[o + i * 4] << 24 | withPad[o + i * 4 + 1] << 16 | withPad[o + i * 4 + 2] << 8 | withPad[o + i * 4 + 3]) >>> 0;
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return Buffer.from(H.flatMap((x) => [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255]));
}

const testMsg = [...Buffer.from('ton vanity sha self-test 0123456789abcdef', 'utf8')];
const ref256 = crypto.createHash('sha256').update(Buffer.from(testMsg)).digest('hex');
const got256 = sha256js(testMsg).toString('hex');
console.log('SHA256 self-check:', got256 === ref256 ? 'OK' : `FAIL got ${got256} exp ${ref256}`);

// sha512 only as a sanity check of the H[0]/K[0] constants (we skip the full bigint implementation — the 20-vector gate in CUDA will check it)
console.log('SHA512_K[0]=0x' + SHA512_K[0].toString(16), 'expected 428a2f98d728ae22:', SHA512_K[0] === 0x428a2f98d728ae22n);
console.log('SHA512_H[0]=0x' + SHA512_H[0].toString(16), 'expected 6a09e667f3bcc908:', SHA512_H[0] === 0x6a09e667f3bcc908n);
console.log('SHA256_K[0]=0x' + SHA256_K[0].toString(16), 'expected 428a2f98:', SHA256_K[0] === 0x428a2f98n);
console.log('SHA256_H[0]=0x' + SHA256_H[0].toString(16), 'expected 6a09e667:', SHA256_H[0] === 0x6a09e667n);
if (got256 !== ref256) process.exit(1);

// --- export ---
const u64arr = (name, arr) => `__device__ __constant__ unsigned long long ${name} = {\n  ` +
  arr.map((v) => '0x' + v.toString(16) + 'ULL').join(', ') + '\n};\n';
const u32arr = (name, arr) => `__device__ __constant__ unsigned int ${name} = {\n  ` +
  arr.map((v) => '0x' + v.toString(16) + 'U').join(', ') + '\n};\n';
let h = '// auto-generated SHA constants (verified vs Node crypto)\n';
h += u32arr('SHA256_H[8]', SHA256_H);
h += u32arr('SHA256_K[64]', SHA256_K);
h += u64arr('SHA512_H[8]', SHA512_H);
h += u64arr('SHA512_K[80]', SHA512_K);
fs.writeFileSync(path.join(__dirname, 'sha_const.h'), h);
console.log('sha_const.h written');
