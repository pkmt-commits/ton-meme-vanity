// Сверка находок vanity.exe (строки «HIT <seedHex> <uq>») официальной либой @ton/ton.
// node src/check_hits.mjs cuda/valera_hits.txt [--keys]   (--keys — печатать ключи; только для тестовых кошельков!)
import fs from 'node:fs';
import { verifySeed } from './verify.mjs';
const file = process.argv[2], showKeys = process.argv.includes('--keys');
let ok = 0, bad = 0;
for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
  const p = l.trim().split(/\s+/); if (p[0] !== 'HIT') continue;
  const v = verifySeed(p[1]);
  const same = v.uq === p[2]; same ? ok++ : bad++;
  console.log(`${same ? 'OK ' : 'НЕ СОШЛОСЬ'} ${v.uq}${same ? '' : '  (GPU: ' + p[2] + ')'}`);
  if (showKeys) console.log(`   seed (приватный ключ, 32 байта): ${p[1]}\n   secretKey (64 байта): ${v.secretKeyHex}\n   pub: ${v.pub}`);
}
console.log(`сошлось ${ok}, не сошлось ${bad}`);
