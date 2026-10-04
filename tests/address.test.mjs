// Быстрый путь «сид → адрес W5» (src/w5.mjs, им пользуется обёртка) против официальной @ton/ton.
// npm test   (видеокарта не нужна; само ядро проверяет npm run selftest)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fromSeed, friendly } from '../src/w5.mjs';
import { verifySeed } from '../src/verify.mjs';

test('fromSeed/friendly == @ton/ton на 300 случайных сидах', () => {
  for (let i = 0; i < 300; i++) {
    const seed = crypto.randomBytes(32);
    const ref = verifySeed(seed.toString('hex'));
    const fast = fromSeed(seed);
    assert.equal(friendly(fast.hash), ref.uq);
  }
});
