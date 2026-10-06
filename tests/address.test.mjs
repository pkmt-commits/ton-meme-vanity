// The fast "seed → W5 address" path (src/w5.mjs, used by the wrapper) against the official @ton/ton.
// npm test   (no GPU needed; the kernel itself is checked by npm run selftest)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fromSeed, friendly } from '../src/w5.mjs';
import { verifySeed } from '../src/verify.mjs';

test('fromSeed/friendly == @ton/ton on 300 random seeds', () => {
  for (let i = 0; i < 300; i++) {
    const seed = crypto.randomBytes(32);
    const ref = verifySeed(seed.toString('hex'));
    const fast = fromSeed(seed);
    assert.equal(friendly(fast.hash), ref.uq);
  }
});
