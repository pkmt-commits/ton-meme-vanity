// Оценка «смешности»: явные находки должны проходить порог сохранения, случайные адреса — нет.
// npm test   (видеокарта не нужна)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { scoreV5 } from '../src/score_v5.mjs';

const SAVE_MIN = 150;   // порог записи в gems.jsonl по умолчанию (src/run_cuda.mjs)

// Настоящие адреса из тестового прогона. Ключи от них уничтожены — деньги на них не отправлять.
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

test('явные находки проходят порог сохранения', () => {
  for (const uq of FUNNY) {
    const r = scoreV5(uq);
    assert.ok(r.score >= SAVE_MIN, `${uq}: score ${r.score} (${r.label})`);
    assert.equal(typeof r.label, 'string');
    assert.ok(Array.isArray(r.reasons));
  }
});

test('случайные адреса почти никогда не проходят порог', () => {
  let passed = 0;
  for (let i = 0; i < 2000; i++) if (scoreV5(randomUq()).score >= SAVE_MIN) passed++;
  // на видеокарте сито пропускает ~1 из 10 000, оценка — малую часть из них; среди 2000 случайных — единицы максимум
  assert.ok(passed <= 5, `прошло порог ${passed} из 2000 случайных`);
});

test('оценка детерминирована и не падает на любых строках из алфавита адреса', () => {
  for (let i = 0; i < 2000; i++) {
    const uq = randomUq();
    const a = scoreV5(uq), b = scoreV5(uq);
    assert.equal(a.score, b.score);
    assert.ok(Number.isFinite(a.score) && a.score >= 0);
  }
});
