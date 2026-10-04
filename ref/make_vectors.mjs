// Эталонные тест-векторы из официальных библиотек @ton/*.
// Используются только для проверки нашей реализации; реальные кошельки отсюда не берём.
import { mnemonicNew, mnemonicToPrivateKey, mnemonicValidate } from '@ton/crypto';
import { WalletContractV5R1 } from '@ton/ton';
import { beginCell } from '@ton/core';
import crypto from 'node:crypto';
import fs from 'node:fs';

const N = Number(process.argv[2] ?? 20);
const out = { w5: {}, valid: [], random: [] };

const probe = WalletContractV5R1.create({ workchain: 0, publicKey: Buffer.alloc(32) });
out.w5.codeHash = probe.init.code.hash().toString('hex');
out.w5.codeDepth = probe.init.code.depth();
out.w5.codeBoc = probe.init.code.toBoc().toString('hex');
out.w5.dataBits = probe.init.data.bits.length;
out.w5.dataHex = probe.init.data.bits.toString();

for (let i = 0; i < N; i++) {
  const words = await mnemonicNew(24);
  const entropy = crypto.createHmac('sha512', words.join(' ')).update('').digest();
  const kp = await mnemonicToPrivateKey(words);
  const w = WalletContractV5R1.create({ workchain: 0, publicKey: kp.publicKey });
  out.valid.push({
    words: words.join(' '),
    entropy: entropy.toString('hex'),
    seed: kp.secretKey.subarray(0, 32).toString('hex'),
    pub: kp.publicKey.toString('hex'),
    hash: w.address.hash.toString('hex'),
    uq: w.address.toString({ bounceable: false, urlSafe: true }),
    eq: w.address.toString({ bounceable: true, urlSafe: true }),
  });
}

// Случайные (в основном невалидные) мнемоники — для проверки фильтра 1/256
const { wordlist } = await import('@ton/crypto/dist/mnemonic/wordlist.js');
for (let i = 0; i < 2000; i++) {
  const words = Array.from({ length: 24 }, () => wordlist[crypto.randomInt(2048)]);
  out.random.push({ words: words.join(' '), valid: await mnemonicValidate(words) });
}
fs.writeFileSync(new URL('./vectors.json', import.meta.url), JSON.stringify(out, null, 1));
console.log('code hash', out.w5.codeHash, 'depth', out.w5.codeDepth, 'dataBits', out.w5.dataBits);
console.log('data', out.w5.dataHex);
console.log('valid random', out.random.filter(r => r.valid).length, '/ 2000');
console.log('example', out.valid[0].uq);
