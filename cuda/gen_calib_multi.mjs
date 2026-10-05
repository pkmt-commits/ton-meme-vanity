// Шаблоны data-ячеек четырёх версий кошелька (W5, V4R2, V3R2, V3R1) для ядра → cuda/calib_multi.h.
// Адрес = SHA-256(StateInit), StateInit = код (фиксирован) + data(seqno, wallet_id, pubkey, …). Из официальной @ton/ton
// берём биты data при нулевом ключе, смещение ключа и префикс StateInit; затем сверяем на случайных ключах.
//   node cuda/gen_calib_multi.mjs
import { WalletContractV5R1, WalletContractV4, WalletContractV3R2, WalletContractV3R1 } from '@ton/ton';
import { beginCell, storeStateInit } from '@ton/core';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'calib_multi.h');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const d2of = (n) => (n >> 3) * 2 + ((n & 7) ? 1 : 0);
function repBytes(bs) {   // байты ячейки с тегом дополнения (если длина не кратна 8)
  const n = bs.length, o = Buffer.alloc(Math.ceil(n / 8));
  for (let i = 0; i < n; i++) if (bs.at(i)) o[i >> 3] |= 1 << (7 - (i & 7));
  if (n & 7) o[n >> 3] |= 1 << (7 - (n & 7));
  return o;
}
const VERS = [['W5', WalletContractV5R1], ['V4R2', WalletContractV4], ['V3R2', WalletContractV3R2], ['V3R1', WalletContractV3R1]];
const rows = [];
for (const [name, C] of VERS) {
  const mk = (pub) => C.create({ workchain: 0, publicKey: pub });
  const w0 = mk(Buffer.alloc(32)), bits = w0.init.data.bits;
  const p1 = Buffer.alloc(32); p1[0] = 0x80;
  const b1 = mk(p1).init.data.bits;
  let off = -1; for (let i = 0; i < bits.length; i++) if (bits.at(i) !== b1.at(i)) { off = i; break; }
  const tpl = repBytes(bits);
  const si = beginCell().store(storeStateInit(w0.init)).endCell();
  const code = si.refs[0], data = si.refs[1];
  const prefix = Buffer.concat([Buffer.from([si.refs.length, d2of(si.bits.length)]), repBytes(si.bits),
    Buffer.from([(code.depth() >> 8) & 255, code.depth() & 255, (data.depth() >> 8) & 255, data.depth() & 255]), code.hash()]);
  if (prefix.length !== 39) throw new Error(`${name}: префикс ${prefix.length} байт, ядро ждёт 39`);
  for (let t = 0; t < 200; t++) {
    const pub = crypto.randomBytes(32), aug = Buffer.from(tpl);
    let bit = off;
    for (let i = 0; i < 32; i++) for (let k = 7; k >= 0; k--) { const bi = bit >> 3, sh = 7 - (bit & 7); if ((pub[i] >> k) & 1) aug[bi] |= 1 << sh; else aug[bi] &= ~(1 << sh); bit++; }
    const h = sha256(Buffer.concat([prefix, sha256(Buffer.concat([Buffer.from([0, d2of(bits.length)]), aug]))]));
    if (!h.equals(mk(pub).address.hash)) throw new Error(`${name}: сверка с @ton/ton не прошла`);
  }
  rows.push({ name, off, d2: d2of(bits.length), tpl: [...tpl], prefix: [...prefix] });
  console.log(`${name}: data ${bits.length} бит, ключ с бита ${off} — OK`);
}
const TL = Math.max(...rows.map((r) => r.tpl.length));
let h = `// auto-generated cuda/gen_calib_multi.mjs: ${rows.map((r) => r.name).join(', ')} (сверено с @ton/ton)\n`;
h += `#define TPL_MAX ${TL}\n`;
h += `__device__ __constant__ int V_OFF[${rows.length}] = {${rows.map((r) => r.off)}};\n`;
h += `__device__ __constant__ int V_D2[${rows.length}] = {${rows.map((r) => r.d2)}};\n`;
h += `__device__ __constant__ int V_TLEN[${rows.length}] = {${rows.map((r) => r.tpl.length)}};\n`;
h += `__device__ __constant__ unsigned char V_TPL[${rows.length}][${TL}] = {${rows.map((r) => '{' + [...r.tpl, ...Array(TL - r.tpl.length).fill(0)] + '}')}};\n`;
h += `__device__ __constant__ unsigned char V_PREFIX[${rows.length}][39] = {${rows.map((r) => '{' + r.prefix + '}')}};\n`;
fs.writeFileSync(out, h);
console.log('→ ' + path.relative(process.cwd(), out));
