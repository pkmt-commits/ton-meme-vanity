// End-to-end check: the fast path == the official library, on random seeds.
import crypto from 'node:crypto';
import { addrHashFromPub, friendly } from './w5.mjs';
import { verifySeed } from './verify.mjs';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
function pubFromSeed(seed) {
  const der = Buffer.concat([PKCS8_PREFIX, seed]);
  const priv = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const spki = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' });
  return spki.subarray(spki.length - 32);
}

const N = 3000;
let ok = 0, bad = 0;
for (let i = 0; i < N; i++) {
  const seed = crypto.randomBytes(32);
  const fastUq = friendly(addrHashFromPub(pubFromSeed(seed)));
  const fastEq = friendly(addrHashFromPub(pubFromSeed(seed)), { bounceable: true });
  const ref = verifySeed(seed.toString('hex'));
  if (fastUq === ref.uq && fastEq === ref.eq) ok++;
  else { bad++; if (bad <= 3) console.error('MISMATCH', { fastUq, refUq: ref.uq }); }
}
console.log(`end-to-end test: ${ok}/${N} match @ton/ton, mismatches: ${bad}`);
process.exit(bad ? 1 : 0);
