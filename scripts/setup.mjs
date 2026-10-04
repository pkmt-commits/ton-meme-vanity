// Установка одной командой: проверка окружения → сборка ядра под вашу видеокарту → самопроверка.
//   npm run setup            (можно запускать повторно; при ошибке печатает, что сделать)
//   npm run setup -- --force (пересобрать ядро, даже если оно уже собрано)
// Только встроенные модули Node: скрипт работает до `npm ci`.
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const EXE = path.join(ROOT, 'cuda', WIN ? 'vanity.exe' : 'vanity');
const force = process.argv.includes('--force');

const ok = (m) => console.log(`  OK    ${m}`);
function fail(step, msg, fix) {
  console.log(`\n  FAIL  ${step}: ${msg}\n\n  Что сделать:\n${fix.map((s) => '    - ' + s).join('\n')}\n`);
  process.exit(1);
}
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

console.log('\nTON Vanity — установка\n');

// 1. Node
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) fail('Node.js', `версия ${process.versions.node}, нужна 20+`, ['Установите Node.js LTS с https://nodejs.org и откройте новый терминал.']);
ok(`Node.js ${process.versions.node}`);

// 2. Зависимости
if (!fs.existsSync(path.join(ROOT, 'node_modules', '@ton', 'ton'))) {
  console.log('  ...   ставлю зависимости (npm ci)');
  const r = WIN ? run('npm ci --no-audit --no-fund', [], { cwd: ROOT, stdio: 'inherit', shell: true })
    : run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) fail('npm ci', 'не удалось поставить зависимости', ['Проверьте интернет и запустите `npm ci` вручную, посмотрите текст ошибки.']);
}
ok('зависимости Node');

// 3. Видеокарта и драйвер
const smi = run('nvidia-smi', ['--query-gpu=name,driver_version,compute_cap', '--format=csv,noheader']);
if (smi.status !== 0 || !smi.stdout.trim()) {
  fail('видеокарта', 'nvidia-smi не найден или не отвечает', [
    'Нужна видеокарта NVIDIA и свежий драйвер: https://www.nvidia.com/drivers',
    'После установки драйвера перезагрузите компьютер и запустите `npm run setup` снова.',
  ]);
}
const [gpuName, driver, cc] = smi.stdout.trim().split('\n')[0].split(',').map((s) => s.trim());
const arch = /^\d+\.\d+$/.test(cc || '') ? 'sm_' + cc.replace('.', '') : 'native';
ok(`видеокарта: ${gpuName}, драйвер ${driver}, архитектура ${arch}`);

// 4. CUDA Toolkit (nvcc)
let nvcc = 'nvcc';
if (run(nvcc, ['--version']).status !== 0) {
  const guess = process.env.CUDA_PATH && path.join(process.env.CUDA_PATH, 'bin', WIN ? 'nvcc.exe' : 'nvcc');
  const linuxGuess = '/usr/local/cuda/bin/nvcc';
  if (guess && fs.existsSync(guess)) nvcc = guess;
  else if (!WIN && fs.existsSync(linuxGuess)) nvcc = linuxGuess;
  else fail('CUDA Toolkit', 'компилятор nvcc не найден', [
    'Установите CUDA Toolkit: https://developer.nvidia.com/cuda-downloads (настройки по умолчанию).',
    'Откройте НОВЫЙ терминал (чтобы обновился PATH) и запустите `npm run setup` снова.',
  ]);
}
const nvccVer = (run(nvcc, ['--version']).stdout.match(/release ([\d.]+)/) || [])[1] || '?';
ok(`CUDA Toolkit ${nvccVer}`);

// 5. Компилятор C++ (Windows: MSVC через vcvars64.bat)
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
  if (!vcvars) fail('компилятор C++', 'Visual Studio Build Tools (MSVC) не найден', [
    'Установите «Build Tools for Visual Studio 2022»: https://visualstudio.microsoft.com/visual-cpp-build-tools/',
    'В установщике отметьте «Разработка классических приложений на C++» (Desktop development with C++).',
    'Или одной командой: winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"',
    'Потом запустите `npm run setup` снова.',
  ]);
  ok('MSVC: ' + vcvars);
}

// 6. Сборка ядра
if (fs.existsSync(EXE) && !force) ok('ядро уже собрано (пересобрать: npm run setup -- --force)');
else {
  console.log(`  ...   собираю ядро под ${arch} (1–3 минуты)`);
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
    const log = ((r.stdout || '') + (r.stderr || '')).split('\n').filter((l) => /error|ошибк|fatal/i.test(l)).slice(0, 15).join('\n');
    fail('сборка ядра', 'nvcc завершился с ошибкой', [
      'Текст ошибки:\n' + (log || (r.stdout || '') + (r.stderr || '')).slice(0, 2000),
      '«unsupported Microsoft Visual Studio version» — поставьте версию Visual Studio, которую поддерживает ваш CUDA Toolkit (обычно 2022).',
      '«unsupported gpu architecture» — CUDA Toolkit слишком новый/старый для вашей карты: поставьте подходящую версию CUDA.',
    ]);
  }
  ok(`ядро собрано за ${Math.round((Date.now() - t0) / 1000)} с`);
}

// 7. Самопроверка: ядро против официальной @ton/ton
const st = run(process.execPath, [path.join(ROOT, 'ref', 'selftest.mjs')], { cwd: ROOT });
if (st.status !== 0) fail('самопроверка', (st.stdout + st.stderr).trim().slice(0, 1500), [
  'Ядро считает адреса неправильно — НЕ используйте его. Пересоберите: npm run setup -- --force',
  'Если не помогло — создайте issue с текстом выше и моделью видеокарты.',
]);
ok(st.stdout.trim());

// 8. Быстрый детектор == эталонный (несколько секунд)
const v = run(EXE, ['validate', '3'], { cwd: path.join(ROOT, 'cuda') });
if (!/VALIDATE OK/.test(v.stdout || '')) fail('сверка детектора', ((v.stdout || '') + (v.stderr || '')).trim().slice(0, 1500), [
  'Пересоберите: npm run setup -- --force. Если не помогло — создайте issue с этим текстом.',
]);
ok('сверка детектора: 0 расхождений');

console.log(`
  Готово. Дальше:
    npm run bench        — скорость вашей карты
    npm run hunt         — охота (Ctrl+C — стоп); находки с КЛЮЧАМИ пишутся в gems.jsonl
    npm run top          — лучшие найденные адреса (без ключей)
    Telegram (по желанию) — см. README, раздел «Telegram»
`);
