// GPU kernel self-test: 20 deterministic test seeds -> the kernel computes the pubkey and the address hash,
// the official @ton/ton computes the same, and we compare them byte by byte. It covers all 4 wallet versions
// (W5, V4R2, V3R2, V3R1) and both curve multiplication paths: with the 16-bit window table and without it (--no-table).
// Seeds = SHA-256("ton-vanity selftest #i") — public, do NOT use them for real money.
//   node ref/selftest.mjs            (needs a built cuda/vanity.exe)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { keyPairFromSeed } from '@ton/crypto';
import { VERSIONS } from '../src/verify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = path.join(ROOT, 'cuda', process.platform === 'win32' ? 'vanity.exe' : 'vanity');
const seeds = Array.from({ length: 20 }, (_, i) => crypto.createHash('sha256').update(`ton-vanity selftest #${i}`).digest('hex'));
const seedFile = path.join(ROOT, 'cuda', 'testseeds.txt');
fs.writeFileSync(seedFile, seeds.join('\n') + '\n');

const names = Object.keys(VERSIONS);
const runs = [...names.map((n, v) => ({ n, v, args: [] })), { n: 'W5', v: 0, args: ['--no-table'] }];
let ok = 0, total = 0;
for (const { n, v, args } of runs) {
  const out = execFileSync(exe, ['selftest', seedFile, String(v), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .trim().split(/\r?\n/).map((l) => l.trim().split(/\s+/));
  seeds.forEach((s, i) => {
    total++;
    const kp = keyPairFromSeed(Buffer.from(s, 'hex'));
    const w = VERSIONS[n].create({ workchain: 0, publicKey: kp.publicKey });
    const pub = Buffer.from(kp.publicKey).toString('hex'), hash = w.address.hash.toString('hex');
    const [gs, gp, gh] = out[i] || [];
    if (gs === s && gp === pub && gh === hash) ok++;
    else console.log(`${n}${args.length ? ' ' + args.join(' ') : ''} #${i} MISMATCH\n  expected ${pub} ${hash}\n  kernel   ${gp} ${gh}`);
  });
}
console.log(`selftest: ${ok}/${total} match @ton/ton (${names.join(', ')}; with and without the table)`);
process.exit(ok === total ? 0 : 1);
