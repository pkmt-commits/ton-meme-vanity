// Независимая перепроверка найденного сида официальной либой @ton/ton.
import { WalletContractV5R1 } from '@ton/ton';
import { keyPairFromSeed } from '@ton/crypto';

export function verifySeed(seedHex) {
  const kp = keyPairFromSeed(Buffer.from(seedHex, 'hex'));
  const w = WalletContractV5R1.create({ workchain: 0, publicKey: kp.publicKey });
  return {
    uq: w.address.toString({ bounceable: false, urlSafe: true }),
    eq: w.address.toString({ bounceable: true, urlSafe: true }),
    raw: w.address.toRawString(),
    pub: Buffer.from(kp.publicKey).toString('hex'),
    secretKeyHex: Buffer.from(kp.secretKey).toString('hex'),
  };
}
