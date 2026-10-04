// Настройка Telegram: узнаём бота, ищем chat_id того, кто написал боту, шлём тест.
import { PROXY } from './net.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfgPath = path.join(ROOT, 'telegram.config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath));
const api = (m, q = '') => `https://api.telegram.org/bot${cfg.token}/${m}${q}`;

console.log('proxy:', PROXY || 'нет (прямой доступ)');
const me = await (await fetch(api('getMe'))).json();
if (!me.ok) { console.log('getMe FAIL:', me.description); process.exit(1); }
console.log('бот: @' + me.result.username, '(' + me.result.first_name + ')');

// кто писал боту?
const upd = await (await fetch(api('getUpdates'))).json();
const chats = new Map();
for (const u of (upd.result || [])) {
  const msg = u.message || u.edited_message;
  if (msg?.chat) chats.set(msg.chat.id, msg.chat.username || msg.chat.first_name || '');
}
if (chats.size) {
  console.log('написали боту:');
  for (const [id, name] of chats) console.log('  chat_id', id, '=> @' + name);
  // предпочтём @loooh, иначе первого
  let pick = null;
  for (const [id, name] of chats) if ((name || '').toLowerCase() === 'loooh') pick = id;
  if (!pick) pick = [...chats.keys()][0];
  cfg.chatId = String(pick);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log('выбран chatId =', cfg.chatId);
} else {
  console.log('боту ещё никто не писал (getUpdates пуст).');
}

// пробный DM
const r = await (await fetch(api('sendMessage'), {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chat_id: cfg.chatId, text: '✅ TON Vanity подключён. Сюда буду слать найденные красивые адреса (без ключей).' }),
})).json();
console.log('тестовый DM:', r.ok ? 'ОТПРАВЛЕН на chat_id ' + cfg.chatId : 'FAIL: ' + r.error_code + ' ' + r.description);
