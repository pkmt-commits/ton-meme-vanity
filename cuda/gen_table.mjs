// Генерирует comb-таблицу для fixed-base ed25519 и ЭТАЛОН всей математики на bigint.
// Если эталон совпадёт с noble для N случайных сидов — те же формулы переносим в CUDA.
import { ed25519 } from '@noble/curves/ed25519.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const P = (1n << 255n) - 19n;
const mod = (a) => ((a % P) + P) % P;
const inv = (a) => {
  // Ферма: a^(p-2)
  let r = 1n, b = mod(a), e = P - 2n;
  while (e > 0n) { if (e & 1n) r = mod(r * b); b = mod(b * b); e >>= 1n; }
  return r;
};
const d = mod(mod(-121665n) * inv(121666n));

const Pt = ed25519.Point;
const B = Pt.BASE;

// --- comb-таблица: base[i][j] = (j+1) * 16^i * B, в виде precomp (y+x, y-x, 2dxy) ---
const table = []; // [64][8] => {yplusx,yminusx,xy2d}
for (let i = 0; i < 64; i++) {
  const row = [];
  // 16^i * B
  let step = B.multiply(1n << BigInt(4 * i));
  for (let j = 0; j < 8; j++) {
    const Pij = step.multiply(BigInt(j + 1));
    const { x, y } = Pij.toAffine();
    row.push({
      yplusx: mod(y + x),
      yminusx: mod(y - x),
      xy2d: mod(mod(2n * d) * mod(x * y)),
    });
  }
  table.push(row);
}

// --- bigint-эталон: ровно те формулы, что пойдут в CUDA ---
// ge_p3: {X,Y,Z,T}; madd с precomp; затем p1p1->p3
function madd(p, q) {
  // r = p + q, где q — precomp (yplusx,yminusx,xy2d), Z_q=1
  const YpX = mod(p.Y + p.X), YmX = mod(p.Y - p.X);
  const A = mod(YpX * q.yplusx);     // ref10: A=YpX*yplusx
  const Bb = mod(YmX * q.yminusx);   // B=YmX*yminusx
  const C = mod(q.xy2d * p.T);       // C=xy2d*T1
  const D = mod(p.Z + p.Z);          // D=2Z1
  const rX = mod(A - Bb), rY = mod(A + Bb), rZ = mod(D + C), rT = mod(D - C); // p1p1
  // p1p1 -> p3
  return { X: mod(rX * rT), Y: mod(rY * rZ), Z: mod(rZ * rT), T: mod(rX * rY) };
}

function scalarbaseComb(aBytes) {
  // a как LE-целое, разбить на 64 ниббла, signed-convert в [-8,8]
  const e = new Array(64);
  for (let i = 0; i < 32; i++) { e[2 * i] = aBytes[i] & 15; e[2 * i + 1] = (aBytes[i] >> 4) & 15; }
  let carry = 0;
  for (let i = 0; i < 63; i++) { e[i] += carry; carry = (e[i] + 8) >> 4; e[i] -= carry << 4; }
  e[63] += carry;
  let h = { X: 0n, Y: 1n, Z: 1n, T: 0n }; // identity
  for (let i = 0; i < 64; i++) {
    const di = e[i];
    if (di === 0) continue;
    const mag = Math.abs(di);
    let q = table[i][mag - 1];
    if (di < 0) q = { yplusx: q.yminusx, yminusx: q.yplusx, xy2d: mod(-q.xy2d) };
    h = madd(h, q);
  }
  return h;
}

function packPub(h) {
  const zi = inv(h.Z);
  const x = mod(h.X * zi), y = mod(h.Y * zi);
  const out = Buffer.alloc(32);
  let yy = y;
  for (let i = 0; i < 32; i++) { out[i] = Number(yy & 255n); yy >>= 8n; }
  out[31] |= Number(x & 1n) << 7;
  return out;
}

// clamp sha512(seed)[0..32]
function scalarFromSeed(seed) {
  const h = crypto.createHash('sha512').update(seed).digest();
  const a = Buffer.from(h.subarray(0, 32));
  a[0] &= 248; a[31] &= 127; a[31] |= 64;
  return a;
}

// --- проверка эталона против noble ---
let ok = 0;
const N = 200;
for (let i = 0; i < N; i++) {
  const seed = crypto.randomBytes(32);
  const a = scalarFromSeed(seed);
  const pub = packPub(scalarbaseComb(a));
  const ref = Buffer.from(ed25519.getPublicKey(seed));
  if (pub.equals(ref)) ok++;
  else if (ok === i) console.error('MISMATCH seed', seed.toString('hex'), '\n got', pub.toString('hex'), '\n exp', ref.toString('hex'));
}
console.log(`bigint-эталон comb vs noble: ${ok}/${N}`);
if (ok !== N) process.exit(1);

// --- экспорт таблицы в limbs 2^51 для CUDA ---
function toLimbs51(n) {
  n = mod(n);
  const L = [];
  const M = (1n << 51n) - 1n;
  for (let k = 0; k < 5; k++) { L.push(n & M); n >>= 51n; }
  return L;
}
let h = '// auto-generated. comb table base[64][8] = (j+1)*16^i*B, precomp (yplusx,yminusx,xy2d), radix 2^51\n';
h += `__device__ unsigned long long BASE_TABLE[64][8][3][5] = {\n`;
for (let i = 0; i < 64; i++) {
  h += ' {';
  for (let j = 0; j < 8; j++) {
    const q = table[i][j];
    const parts = [q.yplusx, q.yminusx, q.xy2d].map((v) => '{' + toLimbs51(v).map((x) => x.toString() + 'ULL').join(',') + '}');
    h += '{' + parts.join(',') + '}' + (j < 7 ? ',' : '');
  }
  h += '}' + (i < 63 ? ',' : '') + '\n';
}
h += '};\n';
// d2 = 2*d для возможной проверки
fs.writeFileSync(path.join(__dirname, 'base_table.h'), h);
console.log('base_table.h записан:', (h.length / 1024).toFixed(0), 'KB');
