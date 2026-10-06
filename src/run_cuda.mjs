// GPU hunt wrapper: stream of hits -> fast address -> score -> log (limit per label)
// + best-of-slot to Telegram with a ⭐ favorite button (+ polling for presses) -> favorites.jsonl.
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
const GEMS = path.join(ROOT, 'gems.jsonl');          // all good finds (with keys)
const FAV = path.join(ROOT, 'favorites.jsonl');       // starred with the button
const SENT = path.join(ROOT, 'data', 'taste', 'sent.jsonl');   // what was sent to the bot (no keys)
const REACT_F = path.join(ROOT, 'data', 'taste', 'reactions.jsonl');   // 👍/😐/👎 from the bot (no keys; the last one per uq wins)
fs.mkdirSync(path.dirname(SENT), { recursive: true });

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MAXTEMP = getArg('--max-temp', '80');
const PER_HOUR = Number(getArg('--per-hour', 11));     // bot messages per hour
const CAP = Number(getArg('--cap', 25));               // how many to keep per label in the file
const MIN_BOT = Number(getArg('--min-bot', 100));      // min. score (v5) to send to the bot
const SAVE_MIN = Number(getArg('--save-min', 150));    // min. score (v5) to save to gems.jsonl
const SLOT_MS = Math.max(30, Math.round(3600 / PER_HOUR)) * 1000;
const START_EVERY = Number(getArg('--start-every', 4)); // every N-th slot is the best with a word/pattern at the start (0 = off)
const VERS = Number(getArg('--versions', 1));          // wallet versions per key: 1 = W5 only, 4 = W5+V4R2+V3R2+V3R1 (~2x more addresses)
const V5T = Number(getArg('--v5t', SAVE_MIN - 10));  // v5-lite sieve threshold on the GPU (v5 points); 0 = old word rules
const START_K = 6;                                     // ranking for the "start" slot: score + START_K·startG (gives the start back the weight v5 cut)

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

const sentMap = new Map();      // uq -> record (for the favorite button)
const favSet = new Set();
if (fs.existsSync(FAV)) for (const l of fs.readFileSync(FAV, 'utf8').split('\n')) { if (l.trim()) try { favSet.add(JSON.parse(l).uq); } catch {} }
const reactMap = new Map();     // uq -> '1' | '0' | '-1'
if (fs.existsSync(REACT_F)) for (const l of fs.readFileSync(REACT_F, 'utf8').split('\n')) { if (l.trim()) try { const j = JSON.parse(l); reactMap.set(j.uq, String(j.r)); } catch {} }

// keyboard: a rating for tuning (👍/😐/👎) + ⭐ "I want it" (a wallet candidate). callback_data ≤ 64 bytes.
const REACT = [['1', '👍'], ['0', '😐'], ['-1', '👎']];
function kb(uq) {
  const r = reactMap.get(uq), fav = favSet.has(uq);
  return { inline_keyboard: [
    REACT.map(([v, e]) => ({ text: r === v ? `${e} ✓` : e, callback_data: `r${v}:${uq}` })),
    [{ text: fav ? '✅ In favorites' : '⭐ I want it', callback_data: fav ? 'x' : `s:${uq}` }],
  ] };
}

let tgOk = 0, tgFail = 0;   // delivered / failed (the dashboard used to say "on" even when Telegram was unreachable)
async function sendGem(rec, slot) {
  if (!TG) return;   // Telegram not configured: write to the file only
  const reasons = rec.reasons.slice(0, 4).join('; ');
  const head = slot === 'start' ? `🅰️ "START" SLOT (score ${rec.score})` : `💎 FIND (score ${rec.score})`;
  const verLine = rec.ver && rec.ver !== 'W5' ? `\nWallet version: ${rec.ver} (MyTonWallet: Settings → Wallet Versions → ${rec.ver})` : '';
  const text = `${head}\n${rec.label} — ${reasons}\nUQ: ${rec.uq}${verLine}\n🔗 https://tonviewer.com/${rec.uq}\nThe seed stays in the file and is never sent to Telegram.`;
  const r = await tgCall('sendMessage', { chat_id: TG.chatId, text, disable_web_page_preview: true, reply_markup: kb(rec.uq) });
  if (r?.ok) tgOk++; else tgFail++;
  sentMap.set(rec.uq, { ...rec, message_id: r?.result?.message_id });
  // a log of what the bot showed, for tuning (⭐ goes to favorites.jsonl, 👍😐👎 to reactions.jsonl). No keys.
  // slot: 'start' = picked by its start, not by the overall score (keep in mind when tuning)
  fs.appendFileSync(SENT, JSON.stringify({ ts: rec.ts, uq: rec.uq, ver: rec.ver, score: rec.score, label: rec.label, message_id: r?.result?.message_id, scorer: 'v5', slot: slot || 'best' }) + '\n');
  if (sentMap.size > 500) { const k = sentMap.keys().next().value; sentMap.delete(k); }
}

// --- bot commands (only from your own chat): /stats /top /pause /resume ---
let paused = false;
async function onCommand(text) {
  const cmd = text.trim().split(/[\s@]/)[0].toLowerCase();
  if (cmd === '/stats' || cmd === '/start') {
    const st = paused ? 'paused' : stopped ? `stopped: ${stopped}` : cooling ? 'cooling' : 'hunting';
    await tgText(`📊 ${st}\nSpeed: ${fmt(Math.round(speed))}/s, ${temp}°C\nChecked: ${fmt(total)} addresses\nSaved this run: ${logged}, sent to the bot: ${slotsSent}, ⭐ total: ${favCount}\nRunning ${hhmmss(Date.now() - startTs)}${mismatches ? `\n⚠️ mismatches: ${mismatches}` : ''}\n\n/top — best finds, /pause — pause, /resume — resume`);
  } else if (cmd === '/top') {
    const best = new Map();
    await eachGem((j) => { if (j.uq && (!best.has(j.uq) || j.score > best.get(j.uq).score)) best.set(j.uq, { uq: j.uq, score: j.score, label: j.label, ver: j.ver }); });
    const rows = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 10);
    await tgText(rows.length ? '🏆 Best in gems.jsonl (no keys):\n' + rows.map((r) => `${r.score} ${r.label}${r.ver && r.ver !== 'W5' ? ' ' + r.ver : ''}\n${r.uq}`).join('\n') : 'gems.jsonl is empty so far');
  } else if (cmd === '/pause') {
    if (paused) { await tgText('Already paused. /resume to continue'); return; }
    paused = true; stopped = 'paused from Telegram'; try { child.kill(); } catch {}
    await tgText('⏸ Hunt paused, the GPU is free. /resume to continue');
  } else if (cmd === '/resume') {
    if (!paused && !stopped) { await tgText('The hunt is already running.'); return; }
    if (stopped && !paused && /overheat|sensor/.test(stopped)) { await tgText(`Stopped by the protection: ${stopped}. Check the card and restart the hunt on the computer.`); return; }
    paused = false; stopped = null; restarts = []; start();
    await tgText('▶ Hunt resumed.');
  }
}

// --- polling for button presses and commands ---
let tgOffset = 0;
async function pollTg() {
  if (TG) try {
    const u = await (await fetch(`${api}/getUpdates?timeout=0&offset=${tgOffset}&allowed_updates=%5B%22callback_query%22%2C%22message%22%5D`)).json();
    for (const upd of (u.result || [])) {
      tgOffset = upd.update_id + 1;
      const msg = upd.message;
      if (msg) { if (String(msg.chat?.id) === String(TG.chatId) && msg.text?.startsWith('/')) await onCommand(msg.text); continue; }
      const cq = upd.callback_query; if (!cq) continue;
      if (String(cq.message?.chat?.id) !== String(TG.chatId)) { await tgCall('answerCallbackQuery', { callback_query_id: cq.id }); continue; }   // buttons only from your own chat
      const d = cq.data || '';
      const m = d.match(/^r(-?[01]):(.+)$/);
      const uq = m ? m[2] : d.startsWith('s:') ? d.slice(2) : d.length === 48 ? d : null;   // 48 characters: old messages (⭐ only)
      if (!uq) { await tgCall('answerCallbackQuery', { callback_query_id: cq.id }); continue; }
      const mid = cq.message?.message_id;
      let answer;
      if (m) {   // 👍/😐/👎 are for tuning only, not added to favorites
        reactMap.set(uq, m[1]);
        fs.appendFileSync(REACT_F, JSON.stringify({ ts: new Date().toISOString(), uq, r: Number(m[1]), message_id: mid }) + '\n');
        answer = `Saved ${REACT.find(([v]) => v === m[1])[1]}`;
      } else {
        let rec = sentMap.get(uq);
        if (!rec) await eachGem((j) => { if (j.uq === uq) { rec = j; return false; } });
        if (rec && !rec.message_id && mid) rec = { ...rec, message_id: mid };   // for tuning: the bot message id
        if (rec && !favSet.has(uq)) { favSet.add(uq); fs.appendFileSync(FAV, JSON.stringify(rec) + '\n'); favCount++; }
        answer = favSet.has(uq) ? '⭐ Saved to favorites' : 'record not found';
      }
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: answer });
      if (cq.message) await tgCall('editMessageReplyMarkup', { chat_id: cq.message.chat.id, message_id: mid, reply_markup: kb(uq) });
    }
  } catch {}
  setTimeout(pollTg, 2500);
}

// --- state ---
let speed = 0, total = 0, temp = 0, sleepMs = 0, cooling = false, stopped = null;
let logged = 0, favCount = favSet.size, slotsSent = 0, startSent = 0, verified = 0, cooldowns = 0, scored = 0, mismatches = 0;
const seen = new Map();          // label -> how many saved
// read gems.jsonl as a stream: it no longer fits into one string (~512 MB is the V8 string limit)
async function eachGem(fn) {
  if (!fs.existsSync(GEMS)) return;
  const rl = readline.createInterface({ input: fs.createReadStream(GEMS, 'utf8'), crlfDelay: Infinity });
  for await (const l of rl) { if (!l.trim()) continue; let j; try { j = JSON.parse(l); } catch { continue; } if (fn(j) === false) { rl.close(); break; } }
}
// carry the limits over from the existing file so a restart doesn't duplicate
await eachGem((j) => { seen.set(j.label, (seen.get(j.label) || 0) + 1); });
const recent = [];
let bestInSlot = null;           // best find of the current slot
let bestStart = null;            // best with a word/pattern at the start over a cycle of START_EVERY slots
let slotTick = 0;
const startTs = Date.now();
let gpuName = '...';

const fmt = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
const hhmmss = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

// A full record with keys only after an independent re-check of the seed with the official library.
const savedSet = new Set();
function makeRec(seedHex, uq, g, ver = 'W5') {
  let v; try { v = verifySeed(seedHex, ver); } catch { return null; }
  verified++;
  if (v.uq !== uq) { mismatches++; return null; }  // the GPU address didn't match: don't trust it
  return { ts: new Date().toISOString(), score: g.score, label: g.label, reasons: g.reasons, uq, ver, eq: v.eq, raw: v.raw, pub: v.pub, seedHex, secretKeyHex: v.secretKeyHex };
}
function saveRec(rec) {
  if (savedSet.has(rec.uq)) return;
  savedSet.add(rec.uq); if (savedSet.size > 5000) savedSet.delete(savedSet.values().next().value);
  fs.appendFileSync(GEMS, JSON.stringify(rec) + '\n');
  logged++;
  recent.unshift({ score: rec.score, label: rec.label, uq: rec.uq }); if (recent.length > 7) recent.pop();
}

// the GPU sends the seed and the ready address: scoring is instant, the heavy check is only for what gets saved
function onHit(seedHex, uqGpu, ver = 'W5') {
  let uq = uqGpu;
  if (!uq) { try { uq = friendly(fromSeed(Buffer.from(seedHex, 'hex')).hash); } catch { return; } } // old exe
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

// bot send slot: the best address of the slot (every 3600/PER_HOUR s)
// every START_EVERY-th slot is the best with a word/pattern at the start (if one was found in the cycle)
setInterval(async () => {
  slotTick++;
  let b = bestInSlot, slot = 'best';
  if (START_EVERY && slotTick % START_EVERY === 0 && bestStart) { b = bestStart; slot = 'start'; bestStart = null; }
  if (bestInSlot === b) bestInSlot = null;
  if (bestStart && bestStart.uq === b?.uq) bestStart = null;
  if (b) {
    const rec = makeRec(b.seedHex, b.uq, b.g, b.ver); if (!rec) return;
    saveRec(rec);                              // whatever is sent is always in the file with its key
    await sendGem(rec, slot); slotsSent++;
    if (slot === 'start') startSent++;
  }
}, SLOT_MS);

function draw() {
  const L = [];
  L.push('');
  L.push('  \x1b[1mTON Vanity — GPU vanity hunt\x1b[0m');
  L.push(`  GPU:   \x1b[36m${gpuName}\x1b[0m`);
  L.push('');
  if (stopped) L.push(`  Status:    \x1b[31mSTOPPED: ${stopped}\x1b[0m`);
  else if (cooling) L.push(`  Status:    \x1b[33m❄ COOLING (GPU idle)\x1b[0m`);
  else L.push(`  Status:    \x1b[32mhunting\x1b[0m`);
  L.push(`  Speed:     \x1b[1m${fmt(Math.round(speed))}/s\x1b[0m  pause ${sleepMs | 0}ms`);
  const tc = temp >= Number(MAXTEMP) + 4 ? '\x1b[31m' : temp >= Number(MAXTEMP) - 2 ? '\x1b[33m' : '\x1b[32m';
  L.push(`  GPU temp:  ${tc}${temp}°C\x1b[0m  (target ~${MAXTEMP}, cooldowns: ${cooldowns})`);
  L.push(`  Checked:   ${fmt(total)} addresses${VERS > 1 ? ` (${VERS} wallet versions per key)` : ''}`);
  L.push(`  Candidates: ${fmt(scored)} scored (v5), keys verified ${verified}${mismatches ? `, \x1b[31mmismatches ${mismatches}\x1b[0m` : ''}`);
  L.push(`  Saved:     \x1b[1m${logged}\x1b[0m finds (score ≥ ${SAVE_MIN})   ⭐ favorites: ${favCount}`);
  const tgState = !TG ? '\x1b[90moff\x1b[0m'
    : tgFail && !tgOk ? `\x1b[31mNOT DELIVERED (${tgFail})\x1b[0m`
    : `\x1b[32mon\x1b[0m, delivered ${tgOk}${tgFail ? `, \x1b[31mfailed ${tgFail}\x1b[0m` : ''}`;
  L.push(`  To bot:    ${slotsSent} (limit ${PER_HOUR}/h, "start" slots ${startSent})  ${tgState}  ${PROXY ? 'via proxy ' + PROXY : 'direct'}`);
  if (bestInSlot) L.push(`  next slot: \x1b[33m${bestInSlot.g.label}\x1b[0m (score ${bestInSlot.g.score})`);
  if (bestStart) L.push(`  next "start" (in ${START_EVERY - (slotTick % START_EVERY)} slots): \x1b[33m${bestStart.g.label}\x1b[0m (score ${bestStart.g.score})`);
  if (recent.length) { L.push(''); L.push('  latest saved:'); for (const r of recent) L.push(`   ${String(r.score).padStart(4)} ${r.label.padEnd(14)} ${r.uq.slice(-18)}`); }
  L.push('');
  L.push(`  running ${hhmmss(Date.now() - startTs)} · Ctrl+C to exit`);
  L.push(`  keys -> gems.jsonl / favorites.jsonl (NEVER show them to anyone)`);
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
    else if (p[0] === 'COOLDOWN') { cooling = true; temp = Number(p[1]); cooldowns++; }  // no DM: routine, visible on the dashboard
    else if (p[0] === 'RESUME') { cooling = false; temp = Number(p[1]); }
    else if (p[0] === 'TEMP_STOP') { stopped = `overheat ${p[1]}°C`; tgText(`🛑 GPU hunt stopped: overheat ${p[1]}°C.`); }
    else if (p[0] === 'TEMP_FAIL') { stopped = 'temperature sensor unavailable'; tgText('🛑 GPU hunt stopped: the temperature sensor is not responding.'); }
  });
  child.stderr.on('data', (d) => { const m = String(d).match(/GPU: ([^\n|]+)/); if (m) gpuName = m[1].trim(); });
  child.on('exit', (code) => {
    if (stopped) return;   // overheat / sensor: don't restart
    restarts = restarts.filter((t) => Date.now() - t < 3600e3);
    if (restarts.length >= 5) { stopped = `kernel keeps crashing (code ${code})`; tgText(`🛑 GPU hunt stopped: the kernel exited with code ${code}; 5 restarts within an hour did not help.`); return; }
    restarts.push(Date.now());
    cooling = false;
    tgText(`⚠️ The kernel exited (code ${code}), restarting in 30 s.`);
    setTimeout(start, 30000);
  });
}
let restarts = [];

start();
pollTg();
setInterval(draw, 400); draw();
tgText(`▶ GPU hunt started (target ~${MAXTEMP}°C, up to ${PER_HOUR} messages/hour: only the best of each slot, every ${START_EVERY}th has a word at the start). 👍😐👎 rate it for tuning, ⭐ = I want it. Commands: /stats /top /pause /resume.`);

process.on('SIGINT', () => { try { child.kill(); } catch {} process.stdout.write(`\n\nstopped. ${logged} finds saved, ${favCount} in favorites.\n`); process.exit(0); });
