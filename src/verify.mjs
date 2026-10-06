// Independent re-check of a found seed with the official @ton/ton library.
// ver is the wallet version: from one key the kernel checks up to 4 addresses (W5, V4R2, V3R2, V3R1, the --versions flag).
import { WalletContractV5R1, WalletContractV4, WalletContractV3R2, WalletContractV3R1 } from '@ton/ton';
import { keyPairFromSeed } from '@ton/crypto';

export const VERSIONS = { W5: WalletContractV5R1, V4R2: WalletContractV4, V3R2: WalletContractV3R2, V3R1: WalletContractV3R1 };

export function verifySeed(seedHex, ver = 'W5') {
  const C = VERSIONS[ver];
  if (!C) throw new Error(`unknown wallet version ${ver}`);
  const kp = keyPairFromSeed(Buffer.from(seedHex, 'hex'));
  const w = C.create({ workchain: 0, publicKey: kp.publicKey });
  return {
    uq: w.address.toString({ bounceable: false, urlSafe: true }),
    eq: w.address.toString({ bounceable: true, urlSafe: true }),
    raw: w.address.toRawString(),
    pub: Buffer.from(kp.publicKey).toString('hex'),
    secretKeyHex: Buffer.from(kp.secretKey).toString('hex'),
  };
}
