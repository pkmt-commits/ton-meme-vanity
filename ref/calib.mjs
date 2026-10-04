// Выводим константы W5R1 из официальной либы (читая биты через .at),
// проверяем против векторов и сохраняем calib.json для быстрого ядра.
import { WalletContractV5R1 } from '@ton/ton';
import crypto from 'node:crypto';
import fs from 'node:fs';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const vectors = JSON.parse(fs.readFileSync(new URL('./vectors.json', import.meta.url)));

function bitsToAugmentedBytes(bs) {
  const n = bs.length;
  const nBytes = Math.ceil((n + 1) / 8); // +1 бит маркера
  const out = Buffer.alloc(nBytes);
  for (let i = 0; i < n; i++) if (bs.at(i)) out[i >> 3] |= 1 << (7 - (i & 7));
  // маркер augmentation: '1' после последнего бита
  out[n >> 3] |= 1 << (7 - (n & 7));
  return out;
}
const d2of = (n) => (n >> 3) * 2 + ((n & 7) ? 1 : 0);

function dataCellHash(dataCell) {
  const n = dataCell.bits.length;
  const aug = bitsToAugmentedBytes(dataCell.bits);
  return sha256(Buffer.concat([Buffer.from([0x00, d2of(n)]), aug]));
}

// шаблон при pubkey=0
const w0 = WalletContractV5R1.create({ workchain: 0, publicKey: Buffer.alloc(32) });
const dataBits = w0.init.data.bits.length;
const templateAug = bitsToAugmentedBytes(w0.init.data.bits);

// найдём смещение pubkey: поставим pub с единственным старшим битом
const pub1 = Buffer.alloc(32); pub1[0] = 0x80;
const w1 = WalletContractV5R1.create({ workchain: 0, publicKey: pub1 });
let off = -1;
for (let i = 0; i < dataBits; i++) if (w0.init.data.bits.at(i) !== w1.init.data.bits.at(i)) { off = i; break; }
if (off < 0) throw new Error('pubkey offset not found');

// соберём CONST_PREFIX для StateInit: representation = d1||d2||own || depths || hashes(code,data)
// Возьмём из либы готовый StateInit cell, прочитаем его биты и refs.
const init = w0.init; // beginCell StateInit построит contractAddress; возьмём через beginCell
// Соберём StateInit-ячейку так же, как делает @ton contractAddress:
import { beginCell, storeStateInit } from '@ton/core';
const siCell = beginCell().store(storeStateInit(init)).endCell();
const siBits = siCell.bits.length;
const siAug = bitsToAugmentedBytes(siCell.bits);
const d1 = siCell.refs.length; // 2, ordinary
const codeCell = siCell.refs[0], dataCell = siCell.refs[1];
const codeHash = codeCell.hash(), codeDepth = codeCell.depth();
const dataDepth = dataCell.depth(); // 0

const CONST_PREFIX = Buffer.concat([
  Buffer.from([d1, d2of(siBits)]), siAug,
  Buffer.from([(codeDepth >> 8) & 255, codeDepth & 255, (dataDepth >> 8) & 255, dataDepth & 255]),
  codeHash,
]);
const DATA_D2 = d2of(dataBits);

// самопроверка: для каждого вектора addrHash = sha256(CONST_PREFIX || dataHash(pub))
function addrHashFromPub(pub) {
  const aug = Buffer.from(templateAug);
  let bit = off;
  for (let i = 0; i < 32; i++) for (let k = 7; k >= 0; k--) {
    const v = (pub[i] >> k) & 1, bi = bit >> 3, sh = 7 - (bit & 7);
    if (v) aug[bi] |= 1 << sh; else aug[bi] &= ~(1 << sh);
    bit++;
  }
  const dataHash = sha256(Buffer.concat([Buffer.from([0x00, DATA_D2]), aug]));
  return sha256(Buffer.concat([CONST_PREFIX, dataHash]));
}

let ok = 0;
for (const v of vectors.valid) {
  if (addrHashFromPub(Buffer.from(v.pub, 'hex')).toString('hex') === v.hash) ok++;
  else { console.error('MISMATCH', v.uq); process.exit(1); }
}

const calib = {
  dataBits, pubkeyBitOffset: off, DATA_D2,
  templateAugHex: templateAug.toString('hex'),
  constPrefixHex: CONST_PREFIX.toString('hex'),
  codeHash: codeHash.toString('hex'), codeDepth,
};
fs.writeFileSync(new URL('./calib.json', import.meta.url), JSON.stringify(calib, null, 1));
console.log(`calibration OK: ${ok}/${vectors.valid.length} vectors match`);
console.log('pubkey bit offset', off, '| dataBits', dataBits, '| prefix', CONST_PREFIX.length, 'B');
