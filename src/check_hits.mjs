// Checks vanity.exe finds (lines "HIT <seedHex> <uq> [version]") against the official @ton/ton library.
// node src/check_hits.mjs cuda/valera_hits.txt [--keys]   (--keys prints the keys; for test wallets only!)
import fs from 'node:fs';
import { verifySeed } from './verify.mjs';
const file = process.argv[2], showKeys = process.argv.includes('--keys');
let ok = 0, bad = 0;
for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
  const p = l.trim().split(/\s+/); if (p[0] !== 'HIT') continue;
  const ver = p[3] || 'W5';
  const v = verifySeed(p[1], ver);
  const same = v.uq === p[2]; same ? ok++ : bad++;
  console.log(`${same ? 'OK ' : 'MISMATCH'} ${v.uq}${ver === 'W5' ? '' : ' (' + ver + ')'}${same ? '' : '  (GPU: ' + p[2] + ')'}`);
  if (showKeys) console.log(`   seed (private key, 32 bytes): ${p[1]}\n   secretKey (64 bytes): ${v.secretKeyHex}\n   pub: ${v.pub}`);
}
console.log(`matched ${ok}, mismatched ${bad}`);
