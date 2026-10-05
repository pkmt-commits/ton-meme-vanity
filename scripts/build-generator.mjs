// Собирает генератор «Свой красивый TON-адрес» (поиск прямо в браузере, без видеокарты и установки) в docs/generate.html.
// Рабочий поток: tweetnacl (низкоуровневые функции) + web/keygen.js (таблица 8 бит, пакетное обращение) + web/address.js
// (W5/V4R2/V3R2/V3R1) + web/lite.js (предфильтр) + точная оценка v5. Самопроверка при запуске — эталонные векторы @ton/ton.
//   npm run build:generator
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { scorerBundle, checkBundle } from './scorer-bundle.mjs';
import { verifySeed } from '../src/verify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { parseCalib } = require('../web/address.js');

const scorer = scorerBundle({ target: 'self', internals: true });
await checkBundle(scorer);
const calib = parseCalib(rd('cuda/calib_multi.h'));
const calibJs = `const CALIB = ${JSON.stringify({ off: calib.off, d2: calib.d2, tlen: calib.tlen, tpl: calib.tpl.map((a) => [...a]), prefix: calib.prefix.map((a) => [...a]) })};\n`
  + 'CALIB.tpl = CALIB.tpl.map((a) => new Uint8Array(a)); CALIB.prefix = CALIB.prefix.map((a) => new Uint8Array(a));\n';
// самопроверка: 3 публичных тестовых сида (SHA-256("ton-vanity selftest #i")) → адреса всех версий от официальной @ton/ton
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
  catch (err) { self.postMessage({ err: 'Не удалось запустить поиск: ' + err.message }); return; }
  // самопроверка: ключи и адреса совпадают с эталоном @ton/ton (иначе — не искать)
  for (const t of VECTORS) {
    const pub = pk(fromHex(t.seed), 1);
    if (hexOf(pub) !== hexOf(self.nacl.sign.keyPair.fromSeed(fromHex(t.seed)).publicKey)) { self.postMessage({ err: 'Самопроверка ключей не прошла — не используйте эту страницу в этом браузере.' }); return; }
    for (let v = 0; v < 4; v++) if (addr(pub, v) !== t.uq[v]) { self.postMessage({ err: 'Самопроверка адресов не прошла — не используйте эту страницу в этом браузере.' }); return; }
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
const head = tpl.slice(0, cut);
const body = tpl.slice(cut).replace('<script>/*WORKER_SRC*/</script>', () => '<script id="wsrc" type="text/plain">' + worker.replace(/<\/script/gi, '<\\/script') + '</script>');
const desc = 'Поиск красивого TON-адреса прямо в браузере: ключи создаются на вашем устройстве, адреса со словами и фразами — для MyTonWallet.';
const htmlPage = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${desc}">
<meta property="og:title" content="Свой красивый TON-адрес">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="social-preview.png">
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`;
const out = path.join(ROOT, 'docs', 'generate.html');
fs.writeFileSync(out, htmlPage);
// та же страница без обвязки <html> — для превью-артефакта
if (process.argv[2]) fs.writeFileSync(process.argv[2], head + body);
console.log(`docs/generate.html: ${(fs.statSync(out).size / 1024).toFixed(0)} КБ (рабочий поток ${(worker.length / 1024).toFixed(0)} КБ)`);
