// Best found addresses WITHOUT KEYS (safe to show and forward).
//   npm run top                 — top 30 from gems.jsonl
//   npm run top -- 100          — top 100
//   npm run top -- 30 --fav     — from favorites.jsonl (the addresses starred with ⭐ in Telegram)
// This script never prints the keys (seedHex, secretKeyHex).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const N = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 30);
const file = path.join(ROOT, process.argv.includes('--fav') ? 'favorites.jsonl' : 'gems.jsonl');
if (!fs.existsSync(file)) { console.log(`${path.basename(file)} does not exist yet — start the hunt: npm run hunt`); process.exit(0); }

const best = new Map();
const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let j; try { j = JSON.parse(line); } catch { continue; }
  if (!j.uq) continue;
  const prev = best.get(j.uq);
  if (!prev || (j.score || 0) > prev.score) best.set(j.uq, { uq: j.uq, score: j.score || 0, label: j.label || '', ts: j.ts || '', ver: j.ver || 'W5' });
}
const rows = [...best.values()].sort((a, b) => b.score - a.score).slice(0, N);
console.log(`${path.basename(file)}: ${best.size} addresses, showing the best ${rows.length} (score, label, address)\n`);
for (const r of rows) console.log(`${String(r.score).padStart(5)}  ${r.label.padEnd(26).slice(0, 26)}  ${r.uq}${r.ver !== 'W5' ? '  (' + r.ver + ')' : ''}`);
