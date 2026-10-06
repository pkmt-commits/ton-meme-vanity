// Address score (how eye-catching an address is): obvious finds must pass the save threshold, random addresses must not.
// npm test   (no GPU needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { scoreV5 } from '../src/score_v5.mjs';

const SAVE_MIN = 150;   // default threshold for writing to gems.jsonl (src/run_cuda.mjs)

// Real addresses from a test run. Their keys have been destroyed — do not send money to them.
const FUNNY = [
  'UQBHZEO8PZ60426yiseuBbJBfSoICVT7TWBuMzW-Baaaaass',
  'UQC5PS0DCjuLHTFvAy-2WB3TfV5utOrqSHWmBNxY3ah2goaT',
  'UQDzdCq-qAR68Lq6KvweGQNDBsYUSVHSo96d25x4xa_0kUSh',
  'UQBLyA25xBc6o4Xwq7ZqJvtQ3HDPsgd4xiOXS7xtf219poor',
  'UQAaPed5QqrkzPoCcm2zpdnWiTx9tfsMfILIk9Gd5-KNfarm',
  'UQBUTTTTqcNR3XnNdRr_kWZyjMbZYYTCdkRNevbpAQQ7G7qP',
];

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const randomUq = () => 'UQ' + 'ABCD'[crypto.randomInt(4)] + Array.from({ length: 45 }, () => B64[crypto.randomInt(64)]).join('');

test('obvious finds pass the save threshold', () => {
  for (const uq of FUNNY) {
    const r = scoreV5(uq);
    assert.ok(r.score >= SAVE_MIN, `${uq}: score ${r.score} (${r.label})`);
    assert.equal(typeof r.label, 'string');
    assert.ok(Array.isArray(r.reasons));
  }
});

test('random addresses almost never pass the threshold', () => {
  let passed = 0;
  for (let i = 0; i < 2000; i++) if (scoreV5(randomUq()).score >= SAVE_MIN) passed++;
  // the GPU sieve passes ~1 in 10,000 addresses and the score accepts a small fraction of those; among 2000 random ones, a handful at most
  assert.ok(passed <= 5, `${passed} of 2000 random addresses passed the threshold`);
});

test('the score is deterministic and does not crash on any string over the address alphabet', () => {
  for (let i = 0; i < 2000; i++) {
    const uq = randomUq();
    const a = scoreV5(uq), b = scoreV5(uq);
    assert.equal(a.score, b.score);
    assert.ok(Number.isFinite(a.score) && a.score >= 0);
  }
});
