// Builds "TON Address Beauty", a page that checks any address with the v5 score right in the browser, into docs/index.html
// (English) and docs/ru/index.html (Russian) for GitHub Pages. The scorer (src/score_v5.mjs + dictionaries) is embedded in
// the page (scripts/scorer-bundle.mjs). The address is never sent anywhere. Page strings live in scripts/i18n.mjs.
//   npm run build:checker
// Rarity tables (LOW/HIGH in scripts/checker-template.html): LOW is the share among 2 million random addresses, HIGH comes
// from hunt data (score ≥150, corrected ×1/3 for addresses the GPU sieve used to miss). +10 points ≈ half as likely.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorerBundle, checkBundle } from './scorer-bundle.mjs';
import { CHECKER, LANGS, localize, pageHead } from './i18n.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = scorerBundle({ target: 'window' });
await checkBundle(bundle);

const tpl = fs.readFileSync(path.join(ROOT, 'scripts', 'checker-template.html'), 'utf8');
const cut = tpl.indexOf('<div class="wrap">');
for (const lang of LANGS) {
  const dict = CHECKER[lang];
  const head = localize(tpl.slice(0, cut), dict);
  const body = localize(tpl.slice(cut), dict).replace('<script>/*SCORER*/</script>', () => '<script>' + bundle.replace(/<\/script/gi, '<\\/script') + '</script>');
  const dir = lang === 'en' ? path.join(ROOT, 'docs') : path.join(ROOT, 'docs', lang);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'index.html');
  fs.writeFileSync(out, `<!doctype html>
<html lang="${lang}">
<head>
${pageHead({ lang, dict, file: 'index.html' })}
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`);
  console.log(`${path.relative(ROOT, out).replace(/\\/g, '/')}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB, the score matches Node`);
}
