// Быстрый вывод адреса W5 (v5r1) из 32-байтного ed25519-сида.
// Константы берутся из ref/calib.json (выведены и проверены против @ton/ton).
import crypto from 'node:crypto';
import nacl from 'tweetnacl';
import fs from 'node:fs';

const C = JSON.parse(fs.readFileSync(new URL('../ref/calib.json', import.meta.url)));
const TEMPLATE = Buffer.from(C.templateAugHex, 'hex');
const CONST_PREFIX = Buffer.from(C.constPrefixHex, 'hex');
const OFF = C.pubkeyBitOffset;
const PRE = Buffer.from([0x00, C.DATA_D2]);

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();

export function addrHashFromPub(pub) {
  const aug = Buffer.from(TEMPLATE);
  let bit = OFF;
  for (let i = 0; i < 32; i++) {
    const b = pub[i];
    for (let k = 7; k >= 0; k--) {
      const bi = bit >> 3, sh = 7 - (bit & 7);
      if ((b >> k) & 1) aug[bi] |= 1 << sh; else aug[bi] &= ~(1 << sh);
      bit++;
    }
  }
  const dataHash = sha256(Buffer.concat([PRE, aug]));
  return sha256(Buffer.concat([CONST_PREFIX, dataHash]));
}

export function fromSeed(seed32) {
  const kp = nacl.sign.keyPair.fromSeed(seed32);
  const pub = Buffer.from(kp.publicKey);
  return { pub, hash: addrHashFromPub(pub) };
}

// --- CRC16-CCITT (XMODEM) ---
const CRC_T = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) { let c = i << 8; for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) : (c << 1); t[i] = c & 0xffff; }
  return t;
})();
function crc16(buf, len) { let c = 0; for (let i = 0; i < len; i++) c = ((c << 8) ^ CRC_T[((c >> 8) ^ buf[i]) & 0xff]) & 0xffff; return c; }

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function b64url(buf) {
  let out = '';
  for (let i = 0; i < buf.length; i += 3) {
    const n = (buf[i] << 16) | ((buf[i + 1] ?? 0) << 8) | (buf[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < buf.length) out += B64[(n >> 6) & 63];
    if (i + 2 < buf.length) out += B64[n & 63];
  }
  return out;
}

const _addr = Buffer.alloc(36);
export function friendly(hash, { bounceable = false, workchain = 0 } = {}) {
  _addr[0] = bounceable ? 0x11 : 0x51;
  _addr[1] = workchain & 0xff;
  hash.copy(_addr, 2);
  const crc = crc16(_addr, 34);
  _addr[34] = crc >> 8; _addr[35] = crc & 0xff;
  return b64url(_addr);
}
