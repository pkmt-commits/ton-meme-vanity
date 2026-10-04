// Прокси для fetch (Telegram в РФ напрямую закрыт). Порядок:
//   1) HTTPS_PROXY / HTTP_PROXY / ALL_PROXY из окружения;
//   2) системный прокси Windows (Параметры → Прокси; его включает VPN/прокси-клиент) — для запуска
//      из Планировщика заданий, где переменных нет (иначе сообщения не доходят).
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { execSync } from 'node:child_process';

function windowsProxy() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"', { encoding: 'utf8', windowsHide: true });
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/.test(out)) return null;
    const m = out.match(/ProxyServer\s+REG_SZ\s+(\S+)/); if (!m) return null;
    let s = m[1];
    if (s.includes('=')) {                       // вид «http=host:port;https=host:port»
      const parts = Object.fromEntries(s.split(';').map((x) => x.split('=')));
      s = parts.https || parts.http || null;
    }
    return s ? (s.includes('://') ? s : 'http://' + s) : null;
  } catch { return null; }
}

const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || windowsProxy();
export const PROXY = proxy || null;
if (proxy) {
  try { setGlobalDispatcher(new ProxyAgent(proxy)); } catch (e) { /* оставляем прямой доступ */ }
}
