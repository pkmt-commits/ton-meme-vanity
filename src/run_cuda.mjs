// GPU-обёртка «охота за гемами»: поток находок -> быстрый адрес -> оценка -> лог (лимит на метку)
// + лучший-за-окно в Telegram с кнопкой ⭐ В избранное (+ опрос нажатий) -> favorites.jsonl.
import { PROXY } from './net.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { fromSeed, friendly } from './w5.mjs';
import { scoreV5 } from './score_v5.mjs';
import { verifySeed } from './verify.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXE = path.join(ROOT, 'cuda', process.platform === 'win32' ? 'vanity.exe' : 'vanity');
const GEMS = path.join(ROOT, 'gems.jsonl');          // все интересные (с ключами)
const FAV = path.join(ROOT, 'favorites.jsonl');       // отмеченные кнопкой
const SENT = path.join(ROOT, 'data', 'taste', 'sent.jsonl');   // что ушло в бот (без ключей)
const REACT_F = path.join(ROOT, 'data', 'taste', 'reactions.jsonl');   // 👍/😐/👎 из бота (без ключей; последняя по uq — актуальная)
fs.mkdirSync(path.dirname(SENT), { recursive: true });

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MAXTEMP = getArg('--max-temp', '80');
const PER_HOUR = Number(getArg('--per-hour', 11));     // лимит сообщений боту в час
const CAP = Number(getArg('--cap', 25));               // сколько хранить на одну метку в файле
const MIN_BOT = Number(getArg('--min-bot', 100));      // мин. score (v5) для отправки в бот
const SAVE_MIN = Number(getArg('--save-min', 150));    // мин. score (v5) для записи в gems.jsonl
const SLOT_MS = Math.max(30, Math.round(3600 / PER_HOUR)) * 1000;
const START_EVERY = Number(getArg('--start-every', 4)); // каждый N-й слот — лучший со словом/узором в начале (0 = выкл)
const VERS = Number(getArg('--versions', 1));          // версий кошелька на один ключ: 1 = только W5, 4 = W5+V4R2+V3R2+V3R1 (адресов в ~2 раза больше)
const V5T = Number(getArg('--v5t', SAVE_MIN - 10));  // порог сита v5-lite на видеокарте (очки v5); 0 — старые правила слов
const START_K = 6;                                     // ранжирование слота «начало»: score + START_K·startG (вернуть началу вес, срезанный в v5)

// --- telegram ---
function loadTg() {
  let token = process.env.TG_BOT_TOKEN, chatId = process.env.TG_CHAT_ID;
  const cfg = path.join(ROOT, 'telegram.config.json');
  if ((!token || !chatId) && fs.existsSync(cfg)) { try { const j = JSON.parse(fs.readFileSync(cfg)); token ||= j.token; chatId ||= j.chatId; } catch {} }
  return token && chatId ? { token, chatId } : null;
}
const TG = loadTg();
const api = TG ? `https://api.telegram.org/bot${TG.token}` : null;
async function tgCall(method, body) { if (!TG) return null; try { const r = await fetch(`${api}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return await r.json(); } catch { return null; } }
async function tgText(text) { if (!TG) return null; return tgCall('sendMessage', { chat_id: TG.chatId, text, disable_web_page_preview: true }); }

const sentMap = new Map();      // uq -> record (для кнопки избранного)
const favSet = new Set();
if (fs.existsSync(FAV)) for (const l of fs.readFileSync(FAV, 'utf8').split('\n')) { if (l.trim()) try { favSet.add(JSON.parse(l).uq); } catch {} }
const reactMap = new Map();     // uq -> '1' | '0' | '-1'
if (fs.existsSync(REACT_F)) for (const l of fs.readFileSync(REACT_F, 'utf8').split('\n')) { if (l.trim()) try { const j = JSON.parse(l); reactMap.set(j.uq, String(j.r)); } catch {} }

// клавиатура: оценка для обучения (👍/😐/👎) + ⭐ «хочу себе» (кандидат в кошелёк). callback_data ≤ 64 байт.
const REACT = [['1', '👍'], ['0', '😐'], ['-1', '👎']];
function kb(uq) {
  const r = reactMap.get(uq), fav = favSet.has(uq);
  return { inline_keyboard: [
    REACT.map(([v, e]) => ({ text: r === v ? `${e} ✓` : e, callback_data: `r${v}:${uq}` })),
    [{ text: fav ? '✅ В избранном' : '⭐ Хочу себе', callback_data: fav ? 'x' : `s:${uq}` }],
  ] };
}

let tgOk = 0, tgFail = 0;   // доставлено / не дошло (раньше панель писала «вкл», даже когда Telegram был недоступен)
async function sendGem(rec, slot) {
  if (!TG) return;   // Telegram не настроен — только запись в файл
  const reasons = rec.reasons.slice(0, 4).join('; ');
  const head = slot === 'start' ? `🅰️ СЛОТ «НАЧАЛО» (score ${rec.score})` : `💎 ГЕМ (score ${rec.score})`;
  const verLine = rec.ver && rec.ver !== 'W5' ? `\nВерсия кошелька: ${rec.ver} (MyTonWallet: Настройки → Wallet Versions → ${rec.ver})` : '';
  const text = `${head}\n${rec.label} — ${reasons}\nUQ: ${rec.uq}${verLine}\n🔗 https://tonviewer.com/${rec.uq}\nСид в файле, в Telegram не шлётся.`;
  const r = await tgCall('sendMessage', { chat_id: TG.chatId, text, disable_web_page_preview: true, reply_markup: kb(rec.uq) });
  if (r?.ok) tgOk++; else tgFail++;
  sentMap.set(rec.uq, { ...rec, message_id: r?.result?.message_id });
  // журнал отправок для обучения (что бот показал; ⭐ — favorites.jsonl, 👍😐👎 — reactions.jsonl). Без ключей.
  // slot: 'start' — отобран по началу, а не по общему score (учитывать при обучении)
  fs.appendFileSync(SENT, JSON.stringify({ ts: rec.ts, uq: rec.uq, ver: rec.ver, score: rec.score, label: rec.label, message_id: r?.result?.message_id, scorer: 'v5', slot: slot || 'best' }) + '\n');
  if (sentMap.size > 500) { const k = sentMap.keys().next().value; sentMap.delete(k); }
}

// --- команды боту (только из своего чата): /stats /top /pause /resume ---
let paused = false;
async function onCommand(text) {
  const cmd = text.trim().split(/[\s@]/)[0].toLowerCase();
  if (cmd === '/stats' || cmd === '/start') {
    const st = paused ? 'на паузе' : stopped ? `остановлено: ${stopped}` : cooling ? 'охлаждение' : 'охота';
    await tgText(`📊 ${st}\nСкорость: ${fmt(Math.round(speed))}/с, ${temp}°C\nПроверено: ${fmt(total)} адресов\nВ файле за запуск: ${logged}, в бот: ${slotsSent}, ⭐ всего: ${favCount}\nРаботает ${hhmmss(Date.now() - startTs)}${mismatches ? `\n⚠️ расхождений: ${mismatches}` : ''}\n\n/top — лучшие, /pause — пауза, /resume — продолжить`);
  } else if (cmd === '/top') {
    const best = new Map();
    await eachGem((j) => { if (j.uq && (!best.has(j.uq) || j.score > best.get(j.uq).score)) best.set(j.uq, { uq: j.uq, score: j.score, label: j.label, ver: j.ver }); });
    const rows = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 10);
    await tgText(rows.length ? '🏆 Лучшие в gems.jsonl (без ключей):\n' + rows.map((r) => `${r.score} ${r.label}${r.ver && r.ver !== 'W5' ? ' ' + r.ver : ''}\n${r.uq}`).join('\n') : 'gems.jsonl пока пуст');
  } else if (cmd === '/pause') {
    if (paused) { await tgText('Уже на паузе. /resume — продолжить'); return; }
    paused = true; stopped = 'пауза из Telegram'; try { child.kill(); } catch {}
    await tgText('⏸ Охота на паузе, видеокарта свободна. /resume — продолжить');
  } else if (cmd === '/resume') {
    if (!paused && !stopped) { await tgText('Охота и так идёт.'); return; }
    if (stopped && !paused && /перегрев|датчик/.test(stopped)) { await tgText(`Остановлено защитой: ${stopped}. Проверьте карту и перезапустите охоту на компьютере.`); return; }
    paused = false; stopped = null; restarts = []; start();
    await tgText('▶ Охота продолжается.');
  }
}

// --- опрос нажатий кнопки и команд ---
let tgOffset = 0;
async function pollTg() {
  if (TG) try {
    const u = await (await fetch(`${api}/getUpdates?timeout=0&offset=${tgOffset}&allowed_updates=%5B%22callback_query%22%2C%22message%22%5D`)).json();
    for (const upd of (u.result || [])) {
      tgOffset = upd.update_id + 1;
      const msg = upd.message;
      if (msg) { if (String(msg.chat?.id) === String(TG.chatId) && msg.text?.startsWith('/')) await onCommand(msg.text); continue; }
      const cq = upd.callback_query; if (!cq) continue;
      if (String(cq.message?.chat?.id) !== String(TG.chatId)) { await tgCall('answerCallbackQuery', { callback_query_id: cq.id }); continue; }   // кнопки — только из своего чата
      const d = cq.data || '';
      const m = d.match(/^r(-?[01]):(.+)$/);
      const uq = m ? m[2] : d.startsWith('s:') ? d.slice(2) : d.length === 48 ? d : null;   // 48 символов — старые сообщения (только ⭐)
      if (!uq) { await tgCall('answerCallbackQuery', { callback_query_id: cq.id }); continue; }
      const mid = cq.message?.message_id;
      let answer;
      if (m) {   // 👍/😐/👎 — только для обучения, в избранное не кладём
        reactMap.set(uq, m[1]);
        fs.appendFileSync(REACT_F, JSON.stringify({ ts: new Date().toISOString(), uq, r: Number(m[1]), message_id: mid }) + '\n');
        answer = `Записал ${REACT.find(([v]) => v === m[1])[1]}`;
      } else {
        let rec = sentMap.get(uq);
        if (!rec) await eachGem((j) => { if (j.uq === uq) { rec = j; return false; } });
        if (rec && !rec.message_id && mid) rec = { ...rec, message_id: mid };   // для обучения: номер сообщения бота
        if (rec && !favSet.has(uq)) { favSet.add(uq); fs.appendFileSync(FAV, JSON.stringify(rec) + '\n'); favCount++; }
        answer = favSet.has(uq) ? '⭐ Сохранено в избранное' : 'не нашёл запись';
      }
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: answer });
      if (cq.message) await tgCall('editMessageReplyMarkup', { chat_id: cq.message.chat.id, message_id: mid, reply_markup: kb(uq) });
    }
  } catch {}
  setTimeout(pollTg, 2500);
}

// --- состояние ---
let speed = 0, total = 0, temp = 0, sleepMs = 0, cooling = false, stopped = null;
let logged = 0, favCount = favSet.size, slotsSent = 0, startSent = 0, verified = 0, cooldowns = 0, scored = 0, mismatches = 0;
const seen = new Map();          // label -> сколько сохранено
// gems.jsonl читаем потоком: целиком в строку он перестаёт влезать (~512 МБ — предел строки V8)
async function eachGem(fn) {
  if (!fs.existsSync(GEMS)) return;
  const rl = readline.createInterface({ input: fs.createReadStream(GEMS, 'utf8'), crlfDelay: Infinity });
  for await (const l of rl) { if (!l.trim()) continue; let j; try { j = JSON.parse(l); } catch { continue; } if (fn(j) === false) { rl.close(); break; } }
}
// переносим лимиты из уже накопленного файла, чтобы при рестарте не дублировать
await eachGem((j) => { seen.set(j.label, (seen.get(j.label) || 0) + 1); });
const recent = [];
let bestInSlot = null;           // лучший гем за текущее окно
let bestStart = null;            // лучший со словом/узором в начале за цикл из START_EVERY окон
let slotTick = 0;
const startTs = Date.now();
let gpuName = '...';

const fmt = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
const hhmmss = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

// Полная запись с ключами — только после независимой перепроверки сида официальной либой.
const savedSet = new Set();
function makeRec(seedHex, uq, g, ver = 'W5') {
  let v; try { v = verifySeed(seedHex, ver); } catch { return null; }
  verified++;
  if (v.uq !== uq) { mismatches++; return null; }  // адрес от GPU не сошёлся — не доверяем
  return { ts: new Date().toISOString(), score: g.score, label: g.label, reasons: g.reasons, uq, ver, eq: v.eq, raw: v.raw, pub: v.pub, seedHex, secretKeyHex: v.secretKeyHex };
}
function saveRec(rec) {
  if (savedSet.has(rec.uq)) return;
  savedSet.add(rec.uq); if (savedSet.size > 5000) savedSet.delete(savedSet.values().next().value);
  fs.appendFileSync(GEMS, JSON.stringify(rec) + '\n');
  logged++;
  recent.unshift({ score: rec.score, label: rec.label, uq: rec.uq }); if (recent.length > 7) recent.pop();
}

// GPU присылает сид и готовый адрес: оценка мгновенная, тяжёлая проверка — только для сохраняемого
function onHit(seedHex, uqGpu, ver = 'W5') {
  let uq = uqGpu;
  if (!uq) { try { uq = friendly(fromSeed(Buffer.from(seedHex, 'hex')).hash); } catch { return; } } // старый exe
  scored++;
  const g = scoreV5(uq);
  if (g.score >= MIN_BOT && (!bestInSlot || g.score > bestInSlot.g.score)) bestInSlot = { seedHex, uq, g, ver };
  if (START_EVERY && g.score >= MIN_BOT && (g.startG > 0 || g.startPat >= 5)) {
    const key = g.score + START_K * g.startG;
    if (!bestStart || key > bestStart.key) bestStart = { seedHex, uq, g, key, ver };
  }
  if (g.score < SAVE_MIN) return;
  const n = seen.get(g.label) || 0;
  if (n >= CAP) return;
  seen.set(g.label, n + 1);
  const rec = makeRec(seedHex, uq, g, ver);
  if (rec) saveRec(rec);
}

// окно отправки в бота: лучший адрес за окно (раз в 3600/PER_HOUR с)
// каждый START_EVERY-й слот — лучший со словом/узором в начале (если такой нашёлся за цикл)
setInterval(async () => {
  slotTick++;
  let b = bestInSlot, slot = 'best';
  if (START_EVERY && slotTick % START_EVERY === 0 && bestStart) { b = bestStart; slot = 'start'; bestStart = null; }
  if (bestInSlot === b) bestInSlot = null;
  if (bestStart && bestStart.uq === b?.uq) bestStart = null;
  if (b) {
    const rec = makeRec(b.seedHex, b.uq, b.g, b.ver); if (!rec) return;
    saveRec(rec);                              // отправленное всегда лежит в файле с ключом
    await sendGem(rec, slot); slotsSent++;
    if (slot === 'start') startSent++;
  }
}, SLOT_MS);

function draw() {
  const L = [];
  L.push('');
  L.push('  \x1b[1mTON Vanity — GPU охота за гемами\x1b[0m');
  L.push(`  карта: \x1b[36m${gpuName}\x1b[0m`);
  L.push('');
  if (stopped) L.push(`  Статус:    \x1b[31mОСТАНОВЛЕНО: ${stopped}\x1b[0m`);
  else if (cooling) L.push(`  Статус:    \x1b[33m❄ ОХЛАЖДЕНИЕ (GPU простаивает)\x1b[0m`);
  else L.push(`  Статус:    \x1b[32mохота\x1b[0m`);
  L.push(`  Скорость:  \x1b[1m${fmt(Math.round(speed))}/s\x1b[0m  пауза ${sleepMs | 0}мс`);
  const tc = temp >= Number(MAXTEMP) + 4 ? '\x1b[31m' : temp >= Number(MAXTEMP) - 2 ? '\x1b[33m' : '\x1b[32m';
  L.push(`  Темп. GPU: ${tc}${temp}°C\x1b[0m  (цель ~${MAXTEMP}, кулдаунов: ${cooldowns})`);
  L.push(`  Проверено: ${fmt(total)} адресов${VERS > 1 ? ` (${VERS} версии кошелька на ключ)` : ''}`);
  L.push(`  Кандидатов: ${fmt(scored)} оценено (v5), проверено ключей ${verified}${mismatches ? `, \x1b[31mрасхождений ${mismatches}\x1b[0m` : ''}`);
  L.push(`  В файле:   \x1b[1m${logged}\x1b[0m гемов (score ≥ ${SAVE_MIN})   ⭐ избранное: ${favCount}`);
  const tgState = !TG ? '\x1b[90mвыкл\x1b[0m'
    : tgFail && !tgOk ? `\x1b[31mНЕ ДОХОДИТ (${tgFail})\x1b[0m`
    : `\x1b[32mвкл\x1b[0m, дошло ${tgOk}${tgFail ? `, \x1b[31mне дошло ${tgFail}\x1b[0m` : ''}`;
  L.push(`  В бота:    ${slotsSent} (лимит ${PER_HOUR}/ч, из них «начало» ${startSent})  ${tgState}  ${PROXY ? 'через прокси ' + PROXY : 'напрямую'}`);
  if (bestInSlot) L.push(`  ждёт слота: \x1b[33m${bestInSlot.g.label}\x1b[0m (score ${bestInSlot.g.score})`);
  if (bestStart) L.push(`  ждёт «начала» (${START_EVERY - (slotTick % START_EVERY)} сл.): \x1b[33m${bestStart.g.label}\x1b[0m (score ${bestStart.g.score})`);
  if (recent.length) { L.push(''); L.push('  последние в файле:'); for (const r of recent) L.push(`   ${String(r.score).padStart(4)} ${r.label.padEnd(14)} ${r.uq.slice(-18)}`); }
  L.push('');
  L.push(`  работает ${hhmmss(Date.now() - startTs)} · Ctrl+C — выход`);
  L.push(`  ключи -> gems.jsonl / favorites.jsonl (НИКОМУ не показывай)`);
  process.stdout.write('\x1b[2J\x1b[H' + L.join('\n') + '\n');
}

let child;
function start() {
  child = spawn(EXE, ['--max-temp', String(MAXTEMP), '--all-dist', String(getArg('--all-dist', '22')), '--versions', String(VERS), '--v5t', String(V5T)], { cwd: ROOT });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'RATE') { total = Number(p[1]); speed = Number(p[2]); }
    else if (p[0] === 'TEMP') { temp = Number(p[1]); sleepMs = Number(p[2]); }
    else if (p[0] === 'HIT') onHit(p[1], p[2], p[3] || 'W5');
    else if (p[0] === 'COOLDOWN') { cooling = true; temp = Number(p[1]); cooldowns++; }  // без DM — рутина, видно в дашборде
    else if (p[0] === 'RESUME') { cooling = false; temp = Number(p[1]); }
    else if (p[0] === 'TEMP_STOP') { stopped = `перегрев ${p[1]}°C`; tgText(`🛑 GPU-охота остановлена: перегрев ${p[1]}°C.`); }
    else if (p[0] === 'TEMP_FAIL') { stopped = 'датчик температуры недоступен'; tgText('🛑 GPU-охота остановлена: датчик температуры не отвечает.'); }
  });
  child.stderr.on('data', (d) => { const m = String(d).match(/GPU: ([^\n|]+)/); if (m) gpuName = m[1].trim(); });
  child.on('exit', (code) => {
    if (stopped) return;   // перегрев / датчик — не перезапускаем
    restarts = restarts.filter((t) => Date.now() - t < 3600e3);
    if (restarts.length >= 5) { stopped = `ядро падает (код ${code})`; tgText(`🛑 GPU-охота остановлена: ядро завершилось с кодом ${code}, 5 перезапусков за час не помогли.`); return; }
    restarts.push(Date.now());
    cooling = false;
    tgText(`⚠️ Ядро завершилось (код ${code}) — перезапуск через 30 с.`);
    setTimeout(start, 30000);
  });
}
let restarts = [];

start();
pollTg();
setInterval(draw, 400); draw();
tgText(`▶ GPU-охота за гемами запущена (цель ~${MAXTEMP}°C, до ${PER_HOUR} сообщений/час — только лучшее за окно, каждый ${START_EVERY}-й — со словом в начале). 👍😐👎 — оценка для обучения, ⭐ — хочу себе. Команды: /stats /top /pause /resume.`);

process.on('SIGINT', () => { try { child.kill(); } catch {} process.stdout.write(`\n\nостановлено. в файле ${logged} гемов, в избранном ${favCount}.\n`); process.exit(0); });
