// Шаблоны версий кошелька в cuda/calib_multi.h (их использует ядро) дают те же адреса, что официальная @ton/ton.
// Видеокарта не нужна: та же формула, что в addr_from_pub_v, повторена на JS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { VERSIONS } from '../src/verify.mjs';

const H = fs.readFileSync(new URL('../cuda/calib_multi.h', import.meta.url), 'utf8');
const arr = (name) => JSON.parse('[' + H.match(new RegExp(name + '\\[[^=]*= \\{(.*)\\};'))[1].replace(/\{/g, '[').replace(/\}/g, ']') + ']');
const OFF = arr('V_OFF'), D2 = arr('V_D2'), TLEN = arr('V_TLEN'), TPL = arr('V_TPL'), PREFIX = arr('V_PREFIX');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

function addrHash(pub, v) {
  const data = Buffer.from(TPL[v].slice(0, TLEN[v]));
  let bit = OFF[v];
  for (let i = 0; i < 32; i++) for (let k = 7; k >= 0; k--) {
    const bi = bit >> 3, sh = 7 - (bit & 7);
    if ((pub[i] >> k) & 1) data[bi] |= 1 << sh; else data[bi] &= ~(1 << sh);
    bit++;
  }
  const dataHash = sha256(Buffer.concat([Buffer.from([0, D2[v]]), data]));
  return sha256(Buffer.concat([Buffer.from(PREFIX[v]), dataHash]));
}

test('calib_multi.h: W5, V4R2, V3R2, V3R1 совпадают с @ton/ton', () => {
  const names = Object.keys(VERSIONS);
  assert.equal(OFF.length, names.length);
  names.forEach((name, v) => {
    for (let t = 0; t < 50; t++) {
      const pub = crypto.randomBytes(32);
      const ref = VERSIONS[name].create({ workchain: 0, publicKey: pub }).address.hash;
      assert.ok(addrHash(pub, v).equals(ref), `${name}: адрес не совпал`);
    }
  });
});
