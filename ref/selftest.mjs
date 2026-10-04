// Самопроверка GPU-ядра: 20 детерминированных тестовых сидов -> ядро считает pubkey и хеш адреса W5,
// то же самое считает официальная @ton/ton, сравниваем побайтно.
// Сиды = SHA-256("ton-vanity selftest #i") — публичные, НЕ использовать под деньги.
//   node ref/selftest.mjs            (нужен собранный cuda/vanity.exe)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WalletContractV5R1 } from '@ton/ton';
import { keyPairFromSeed } from '@ton/crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = path.join(ROOT, 'cuda', process.platform === 'win32' ? 'vanity.exe' : 'vanity');
const seeds = Array.from({ length: 20 }, (_, i) => crypto.createHash('sha256').update(`ton-vanity selftest #${i}`).digest('hex'));
const seedFile = path.join(ROOT, 'cuda', 'testseeds.txt');
fs.writeFileSync(seedFile, seeds.join('\n') + '\n');

const out = execFileSync(exe, ['selftest', seedFile], { encoding: 'utf8' }).trim().split(/\r?\n/).map((l) => l.trim().split(/\s+/));
let ok = 0;
seeds.forEach((s, i) => {
  const kp = keyPairFromSeed(Buffer.from(s, 'hex'));
  const w = WalletContractV5R1.create({ workchain: 0, publicKey: kp.publicKey });
  const pub = Buffer.from(kp.publicKey).toString('hex'), hash = w.address.hash.toString('hex');
  const [gs, gp, gh] = out[i] || [];
  if (gs === s && gp === pub && gh === hash) ok++;
  else console.log(`#${i} НЕ СОШЛОСЬ\n  ждали ${pub} ${hash}\n  ядро  ${gp} ${gh}`);
});
console.log(`selftest: ${ok}/${seeds.length} совпало с @ton/ton`);
process.exit(ok === seeds.length ? 0 : 1);
