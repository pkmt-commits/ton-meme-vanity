// Telegram setup: look up the bot, find the chat_id of whoever has messaged the bot, send a test message.
import { PROXY } from './net.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfgPath = path.join(ROOT, 'telegram.config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath));
const api = (m, q = '') => `https://api.telegram.org/bot${cfg.token}/${m}${q}`;

console.log('proxy:', PROXY || 'none (direct connection)');
const me = await (await fetch(api('getMe'))).json();
if (!me.ok) { console.log('getMe FAIL:', me.description); process.exit(1); }
console.log('bot: @' + me.result.username, '(' + me.result.first_name + ')');

// who has messaged the bot?
const upd = await (await fetch(api('getUpdates'))).json();
const chats = new Map();
for (const u of (upd.result || [])) {
  const msg = u.message || u.edited_message;
  if (msg?.chat) chats.set(msg.chat.id, msg.chat.username || msg.chat.first_name || '');
}
if (chats.size) {
  console.log('messaged the bot:');
  for (const [id, name] of chats) console.log('  chat_id', id, '=> @' + name);
  // the first chat; if several people messaged the bot, put the right chat_id into telegram.config.json by hand
  const pick = [...chats.keys()][0];
  cfg.chatId = String(pick);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log('selected chatId =', cfg.chatId);
} else {
  console.log('nobody has messaged the bot yet (getUpdates is empty).');
}

// test DM
const r = await (await fetch(api('sendMessage'), {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chat_id: cfg.chatId, text: '✅ TON Vanity is connected. I will send the beautiful addresses I find here (no keys).' }),
})).json();
console.log('test DM:', r.ok ? 'SENT to chat_id ' + cfg.chatId : 'FAIL: ' + r.error_code + ' ' + r.description);
