// Run the kernel with arguments on any OS: node scripts/kernel.mjs bench 60 --all-dist 22
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = path.join(ROOT, 'cuda', process.platform === 'win32' ? 'vanity.exe' : 'vanity');
const r = spawnSync(exe, process.argv.slice(2), { cwd: path.join(ROOT, 'cuda'), stdio: 'inherit' });
if (r.error) { console.error('kernel not found — run this first: npm run setup'); process.exit(1); }
process.exit(r.status ?? 1);
