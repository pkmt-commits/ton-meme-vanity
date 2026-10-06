// One-command setup: environment check → kernel build for your GPU → self-test.
//   npm run setup            (safe to re-run; on failure it prints what to do)
//   npm run setup -- --force (rebuild the kernel even if it is already built)
// Built-in Node modules only: the script runs before `npm ci`.
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const EXE = path.join(ROOT, 'cuda', WIN ? 'vanity.exe' : 'vanity');
let force = process.argv.includes('--force');

const ok = (m) => console.log(`  OK    ${m}`);
function fail(step, msg, fix) {
  console.log(`\n  FAIL  ${step}: ${msg}\n\n  What to do:\n${fix.map((s) => '    - ' + s).join('\n')}\n`);
  process.exit(1);
}
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

console.log('\nTON Vanity — setup\n');

// 1. Node
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) fail('Node.js', `version ${process.versions.node}, 20+ required`, ['Install Node.js LTS from https://nodejs.org and open a new terminal.']);
ok(`Node.js ${process.versions.node}`);

// 2. Dependencies
if (!fs.existsSync(path.join(ROOT, 'node_modules', '@ton', 'ton'))) {
  console.log('  ...   installing dependencies (npm ci)');
  const r = WIN ? run('npm ci --no-audit --no-fund', [], { cwd: ROOT, stdio: 'inherit', shell: true })
    : run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) fail('npm ci', 'failed to install dependencies', ['Check your internet connection, run `npm ci` manually and read the error.']);
}
ok('Node dependencies');

// 3. GPU and driver
const smi = run('nvidia-smi', ['--query-gpu=name,driver_version,compute_cap', '--format=csv,noheader']);
if (smi.status !== 0 || !smi.stdout.trim()) {
  fail('GPU', 'nvidia-smi not found or not responding', [
    'You need an NVIDIA GPU and a recent driver: https://www.nvidia.com/drivers',
    'After installing the driver, reboot and run `npm run setup` again.',
  ]);
}
const [gpuName, driver, cc] = smi.stdout.trim().split('\n')[0].split(',').map((s) => s.trim());
const arch = /^\d+\.\d+$/.test(cc || '') ? 'sm_' + cc.replace('.', '') : 'native';
ok(`GPU: ${gpuName}, driver ${driver}, architecture ${arch}`);

// 4. CUDA Toolkit (nvcc)
let nvcc = 'nvcc';
if (run(nvcc, ['--version']).status !== 0) {
  const guess = process.env.CUDA_PATH && path.join(process.env.CUDA_PATH, 'bin', WIN ? 'nvcc.exe' : 'nvcc');
  const linuxGuess = '/usr/local/cuda/bin/nvcc';
  if (guess && fs.existsSync(guess)) nvcc = guess;
  else if (!WIN && fs.existsSync(linuxGuess)) nvcc = linuxGuess;
  else fail('CUDA Toolkit', 'nvcc compiler not found', [
    'Install the CUDA Toolkit: https://developer.nvidia.com/cuda-downloads (default options).',
    'Open a NEW terminal (so PATH is updated) and run `npm run setup` again.',
  ]);
}
const nvccVer = (run(nvcc, ['--version']).stdout.match(/release ([\d.]+)/) || [])[1] || '?';
ok(`CUDA Toolkit ${nvccVer}`);

// 5. C++ compiler (Windows: MSVC via vcvars64.bat)
let vcvars = null;
if (WIN) {
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const vswhere = path.join(pf86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (fs.existsSync(vswhere)) {
    const r = run(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath']);
    const p = r.stdout && r.stdout.trim().split(/\r?\n/)[0];
    if (p && fs.existsSync(path.join(p, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat'))) vcvars = path.join(p, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  }
  if (!vcvars) {
    for (const ver of ['2022', '2019']) for (const ed of ['BuildTools', 'Community', 'Professional', 'Enterprise']) for (const base of [pf86, process.env.ProgramFiles || 'C:\\Program Files']) {
      const p = path.join(base, 'Microsoft Visual Studio', ver, ed, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
      if (!vcvars && fs.existsSync(p)) vcvars = p;
    }
  }
  if (!vcvars) fail('C++ compiler', 'Visual Studio Build Tools (MSVC) not found', [
    'Install "Build Tools for Visual Studio 2022": https://visualstudio.microsoft.com/visual-cpp-build-tools/',
    'In the installer, select "Desktop development with C++".',
    'Or with one command: winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"',
    'Then run `npm run setup` again.',
  ]);
  ok('MSVC: ' + vcvars);
}

// 5b. The v5-lite sieve dictionary, built from the same score as src/score_v5.mjs (taste edits reach the GPU right away)
{
  const g = run(process.execPath, [path.join(ROOT, 'src', 'gpu_dict_v5.mjs')], { cwd: ROOT });
  if (g.status !== 0) fail('sieve dictionary', ((g.stdout || '') + (g.stderr || '')).trim().slice(0, 1500), ['Check src/score_v5.mjs and data/: they must load without errors (npm test).']);
  const hdr = path.join(ROOT, 'cuda', 'v5dict.h');
  if (fs.existsSync(EXE) && fs.statSync(hdr).mtimeMs > fs.statSync(EXE).mtimeMs && !force) { force = true; ok('sieve dictionary changed: rebuilding the kernel'); }
  else ok((g.stdout || '').trim());
}

// 6. Kernel build
if (fs.existsSync(EXE) && !force) ok('kernel already built (to rebuild: npm run setup -- --force)');
else {
  console.log(`  ...   building the kernel for ${arch} (1–3 minutes)`);
  const t0 = Date.now();
  const nvArgs = `-O3 -arch=${arch} -o ${WIN ? 'vanity.exe' : 'vanity'} vanity.cu ${WIN ? '-lnvml' : '-lnvidia-ml'}`;
  let r;
  if (WIN) {
    const line = `"call "${vcvars}" >nul 2>&1 && "${nvcc}" ${nvArgs}"`;
    r = run('cmd.exe', ['/d', '/s', '/c', line], { cwd: path.join(ROOT, 'cuda'), windowsVerbatimArguments: true });
  } else {
    r = run(nvcc, nvArgs.split(' '), { cwd: path.join(ROOT, 'cuda') });
  }
  const fresh = fs.existsSync(EXE) && fs.statSync(EXE).mtimeMs >= t0 - 2000;
  if (r.status !== 0 || !fresh) {
    // "ошибк" catches MSVC errors on a Russian-language Windows ("ошибка C2065")
    const log = ((r.stdout || '') + (r.stderr || '')).split('\n').filter((l) => /error|ошибк|fatal/i.test(l)).slice(0, 15).join('\n');
    fail('kernel build', 'nvcc failed', [
      'Error output:\n' + (log || (r.stdout || '') + (r.stderr || '')).slice(0, 2000),
      '"unsupported Microsoft Visual Studio version": install a Visual Studio version your CUDA Toolkit supports (usually 2022).',
      '"unsupported gpu architecture": the CUDA Toolkit is too new/old for your card; install a matching CUDA version.',
    ]);
  }
  ok(`kernel built in ${Math.round((Date.now() - t0) / 1000)} s`);
}

// 6b. The 16-bit window table (60 MB, generated in a few seconds; without it the kernel is half as fast)
const TBL = path.join(ROOT, 'cuda', 'tbl16.bin');
if (fs.existsSync(TBL) && fs.statSync(TBL).size === 62914560 && !force) ok('table cuda/tbl16.bin is in place');
else {
  const g = run(process.execPath, [path.join(ROOT, 'cuda', 'gen_wtable.mjs')], { cwd: ROOT });
  if (g.status !== 0) fail('speed-up table', ((g.stdout || '') + (g.stderr || '')).trim().slice(0, 1500), [
    'The kernel also works without the table, but half as fast. Try again: npm run setup -- --force',
  ]);
  ok((g.stdout || '').trim());
}

// 7. Self-test: the kernel against the official @ton/ton
const st = run(process.execPath, [path.join(ROOT, 'ref', 'selftest.mjs')], { cwd: ROOT });
if (st.status !== 0) fail('self-test', (st.stdout + st.stderr).trim().slice(0, 1500), [
  'The kernel computes wrong addresses: do NOT use it. Rebuild: npm run setup -- --force',
  'If that doesn\'t help, open an issue with the text above and your GPU model.',
]);
ok(st.stdout.trim());

// 7b. The v5-lite sieve == the src/score_v5.mjs score
const v5c = run(process.execPath, [path.join(ROOT, 'ref', 'check_v5lite.mjs')], { cwd: ROOT });
if (v5c.status !== 0) fail('v5-lite sieve check', ((v5c.stdout || '') + (v5c.stderr || '')).trim().slice(0, 1500), [
  'Rebuild: npm run setup -- --force. If that doesn\'t help, open an issue with this text.',
]);
ok((v5c.stdout || '').trim());

// 8. The fast detector == the reference one (a few seconds)
const v = run(EXE, ['validate', '3'], { cwd: path.join(ROOT, 'cuda') });
if (!/VALIDATE OK/.test(v.stdout || '')) fail('detector check', ((v.stdout || '') + (v.stderr || '')).trim().slice(0, 1500), [
  'Rebuild: npm run setup -- --force. If that doesn\'t help, open an issue with this text.',
]);
ok('detector check: 0 mismatches');

console.log(`
  Done. Next:
    npm run bench        — your GPU speed
    npm run hunt         — hunt (Ctrl+C to stop); finds WITH KEYS are written to gems.jsonl
    npm run top          — best addresses found (no keys)
    Telegram (optional): see README, section "Telegram"
`);
