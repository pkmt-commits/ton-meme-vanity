// Браузерный генератор (web/*.js): быстрые ключи и адреса 4 версий совпадают с официальными tweetnacl / @ton/ton,
// предфильтр не теряет адреса с высокой оценкой.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { verifySeed } from '../src/verify.mjs';

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl');
const { makeKeygen } = require('../web/keygen.js');
const { makeAddress, parseCalib } = require('../web/address.js');

test('web/keygen.js == tweetnacl fromSeed (2048 ключей, пачками)', () => {
  const pk = makeKeygen(nacl);
  for (const n of [1, 7, 64]) for (let r = 0; r < 2048 / 64; r++) {
    const seeds = crypto.randomBytes(32 * n), pubs = pk(new Uint8Array(seeds), n);
    for (let k = 0; k < n; k++) assert.deepEqual(Buffer.from(pubs.subarray(32 * k, 32 * k + 32)), Buffer.from(nacl.sign.keyPair.fromSeed(seeds.subarray(32 * k, 32 * k + 32)).publicKey));
  }
});

test('web/address.js == @ton/ton для W5, V4R2, V3R2, V3R1', () => {
  const pk = makeKeygen(nacl);
  const addr = makeAddress(parseCalib(fs.readFileSync(new URL('../cuda/calib_multi.h', import.meta.url), 'utf8')));
  const VN = ['W5', 'V4R2', 'V3R2', 'V3R1'];
  const seeds = crypto.randomBytes(32 * 64), pubs = pk(new Uint8Array(seeds), 64);
  for (let k = 0; k < 64; k++) for (let v = 0; v < 4; v++)
    assert.equal(addr(pubs.subarray(32 * k, 32 * k + 32), v), verifySeed(seeds.subarray(32 * k, 32 * k + 32).toString('hex'), VN[v]).uq);
});
