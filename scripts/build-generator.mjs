// Builds the in-browser generator (search right in the browser, no GPU, no install) into docs/generate.html (English) and
// docs/ru/generate.html (Russian). Worker: tweetnacl (low-level functions) + web/keygen.js (8-bit table, batched inversion) +
// web/address.js (W5/V4R2/V3R2/V3R1) + web/lite.js (prefilter) + the exact v5 score. On start it self-tests against
// reference vectors from @ton/ton. Page strings live in scripts/i18n.mjs.
//   npm run build:generator
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { scorerBundle, checkBundle } from './scorer-bundle.mjs';
import { verifySeed } from '../src/verify.mjs';
import { GENERATOR, LANGS, localize, pageHead } from './i18n.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { parseCalib } = require('../web/address.js');

const scorer = scorerBundle({ target: 'self', internals: true });
await checkBundle(scorer);
const calib = parseCalib(rd('cuda/calib_multi.h'));
const calibJs = `const CALIB = ${JSON.stringify({ off: calib.off, d2: calib.d2, tlen: calib.tlen, tpl: calib.tpl.map((a) => [...a]), prefix: calib.prefix.map((a) => [...a]) })};\n`
  + 'CALIB.tpl = CALIB.tpl.map((a) => new Uint8Array(a)); CALIB.prefix = CALIB.prefix.map((a) => new Uint8Array(a));\n';
// self-test: 3 public test seeds (SHA-256("ton-vanity selftest #i")) → addresses of all versions from the official @ton/ton
const VN = ['W5', 'V4R2', 'V3R2', 'V3R1'];
const vectors = [0, 1, 2].map((i) => { const seed = crypto.createHash('sha256').update(`ton-vanity selftest #${i}`).digest('hex');
  return { seed, uq: VN.map((v) => verifySeed(seed, v).uq) }; });

const worker = `${rd('node_modules/tweetnacl/nacl-fast.min.js')}
${rd('web/keygen.js')}
${rd('web/address.js')}
${rd('web/lite.js')}
${scorer}
${calibJs}
const VECTORS = ${JSON.stringify(vectors)};
const VN = ${JSON.stringify(VN)};
const hexOf = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
self.onmessage = (e) => {
  const ver = e.data.ver, MIN = e.data.min;
  let pk, addr, lite;
  try { pk = makeKeygen(self.nacl); addr = makeAddress(CALIB); lite = makeLite(self.__v5); }
  catch (err) { self.postMessage({ err: 'start', msg: err.message }); return; }
  // self-test: keys and addresses match the @ton/ton reference (otherwise do not search); the page shows the error text
  for (const t of VECTORS) {
    const pub = pk(fromHex(t.seed), 1);
    if (hexOf(pub) !== hexOf(self.nacl.sign.keyPair.fromSeed(fromHex(t.seed)).publicKey)) { self.postMessage({ err: 'keys' }); return; }
    for (let v = 0; v < 4; v++) if (addr(pub, v) !== t.uq[v]) { self.postMessage({ err: 'addr' }); return; }
  }
  self.postMessage({ ready: true });
  const BATCH = 64, seeds = new Uint8Array(32 * BATCH);
  let n = 0, found = [], last = performance.now();
  for (;;) {
    crypto.getRandomValues(seeds);
    const pubs = pk(seeds, BATCH);
    for (let k = 0; k < BATCH; k++) {
      const pub = pubs.subarray(32 * k, 32 * k + 32);
      for (let v = 0; v < ver; v++) {
        n++;
        const uq = addr(pub, v);
        if (lite(uq) * 10 < 60) continue;
        const g = self.scoreV5(uq);
        if (g.score >= MIN) found.push({ uq, ver: VN[v], score: g.score, label: g.label, reasons: g.reasons, words: g.words, seed: hexOf(seeds.subarray(32 * k, 32 * k + 32)) });
      }
    }
    const now = performance.now();
    if (now - last > 400) { found.sort((a, b) => b.score - a.score); self.postMessage({ n, found: found.slice(0, 12) }); found = []; last = now; }
  }
};
`;
const tpl = rd('scripts/generator-template.html');
const cut = tpl.indexOf('<div class="wrap">');
const workerTag = '<script id="wsrc" type="text/plain">' + worker.replace(/<\/script/gi, '<\\/script') + '</script>';
for (const lang of LANGS) {
  const dict = GENERATOR[lang];
  const head = localize(tpl.slice(0, cut), dict);
  const body = localize(tpl.slice(cut), dict).replace('<script>/*WORKER_SRC*/</script>', () => workerTag);
  const dir = lang === 'en' ? path.join(ROOT, 'docs') : path.join(ROOT, 'docs', lang);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'generate.html');
  fs.writeFileSync(out, `<!doctype html>
<html lang="${lang}">
<head>
${pageHead({ lang, dict, file: 'generate.html' })}
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`);
  // the same page without the <html> wrapper, for a preview artifact
  if (lang === 'en' && process.argv[2]) fs.writeFileSync(process.argv[2], head + body);
  console.log(`${path.relative(ROOT, out).replace(/\\/g, '/')}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB (worker ${(worker.length / 1024).toFixed(0)} KB)`);
}
