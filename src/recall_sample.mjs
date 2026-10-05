// Выборка случайных адресов для замера полноты GPU-сита: N случайных хешей → адрес UQ → scoreV5 → всё с score ≥ MIN
// пишется в файл (только адреса, ключей нет — это не кошельки). Параллельно на всех ядрах.
//   node src/recall_sample.mjs <N в миллионах> <out.jsonl> [min=90]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';

if (isMainThread) {
  const N = Math.round(Number(process.argv[2] || 10) * 1e6), out = process.argv[3] || 'recall_sample.jsonl', MIN = Number(process.argv[4] || 90);
  const W = Math.max(1, os.cpus().length - 1), per = Math.ceil(N / W);
  const t0 = Date.now(); let done = 0, kept = 0, fin = 0; const hist = {};
  const ws = fs.createWriteStream(out);
  for (let i = 0; i < W; i++) {
    const w = new Worker(new URL(import.meta.url), { workerData: { n: per, min: MIN } });
    w.on('message', (m) => {
      if (m.rows) { for (const r of m.rows) ws.write(JSON.stringify(r) + '\n'); kept += m.rows.length; }
      if (m.done) done += m.done;
      if (m.hist) for (const [k, v] of Object.entries(m.hist)) hist[k] = (hist[k] || 0) + v;
      if (m.fin && ++fin === W) {
        ws.end();
        console.log(JSON.stringify({ N: done, kept, sec: (Date.now() - t0) / 1000, hist }));
      }
    });
  }
  const iv = setInterval(() => { if (fin === W) return clearInterval(iv); process.stderr.write(`\r${(done / 1e6).toFixed(1)}M / ${(N / 1e6).toFixed(0)}M, kept ${kept}, ${Math.round(done / ((Date.now() - t0) / 1000))}/s   `); }, 5000);
} else {
  const { scoreV5 } = await import('./score_v5.mjs');
  const { friendly } = await import('./w5.mjs');
  const { n, min } = workerData;
  const buf = Buffer.alloc(32 * 4096); let rows = [], hist = {};
  for (let i = 0; i < n; i++) {
    if (i % 4096 === 0) crypto.randomFillSync(buf);
    const uq = friendly(buf.subarray((i % 4096) * 32, (i % 4096) * 32 + 32));
    const g = scoreV5(uq);
    const b = Math.floor(g.score / 10) * 10; if (b >= 20) hist[b] = (hist[b] || 0) + 1;
    if (g.score >= min) rows.push({ uq, score: g.score, label: g.label, reasons: g.reasons });
    if ((i + 1) % 200000 === 0) { parentPort.postMessage({ rows, done: 200000 }); rows = []; }
  }
  parentPort.postMessage({ rows, done: n % 200000, hist, fin: true });
}
