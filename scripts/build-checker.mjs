// Собирает «Красоту TON-адреса» — страницу проверки любого адреса оценкой v5 прямо в браузере — в docs/index.html (GitHub Pages).
// Оценщик (src/score_v5.mjs + словари) вшивается в страницу (scripts/scorer-bundle.mjs). Адрес никуда не отправляется.
//   npm run build:checker
// Таблицы редкости (LOW/HIGH в scripts/checker-template.html): LOW — доля из 2 млн случайных адресов, HIGH — по данным
// охоты (score ≥150, поправка ×1/3 на адреса, которые сито видеокарты не пропускало). +10 очков ≈ вдвое реже.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorerBundle, checkBundle } from './scorer-bundle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = scorerBundle({ target: 'window' });
await checkBundle(bundle);

const tpl = fs.readFileSync(path.join(ROOT, 'scripts', 'checker-template.html'), 'utf8');
const cut = tpl.indexOf('<div class="wrap">');
const head = tpl.slice(0, cut), body = tpl.slice(cut).replace('<script>/*SCORER*/</script>', () => '<script>' + bundle.replace(/<\/script/gi, '<\\/script') + '</script>');
const desc = 'Вставь TON-адрес — покажет спрятанные слова и узоры, насколько адрес интересный, красивый и мемный и как редко такое выпадает.';
const out = path.join(ROOT, 'docs', 'index.html');
fs.writeFileSync(out, `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${desc}">
<meta property="og:title" content="Красота TON-адреса">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="social-preview.png">
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`);
console.log(`docs/index.html: ${(fs.statSync(out).size / 1024).toFixed(0)} КБ, оценка совпадает с Node`);
