// Strings for the two web pages (docs/): English is the default, Russian is built into docs/ru/.
// Templates use {{key}} in HTML and `const T = /*T*/null;` in the page script (replaced with the JSON of the page's strings).
// Reasons from src/score_v5.mjs are English; `reasons` lists regex → replacement pairs that translate them for display.
export const SITE = 'https://pkmt-commits.github.io/ton-meme-vanity/';
export const LANGS = ['en', 'ru'];

const REASONS_RU = [
  ['^start: ', 'начало: '], ['^end: ', 'хвост: '], ['^end (.)×', 'хвост $1×'],
  ['^stretch: ', 'растяжка: '], ['^stretch ', 'растяжка '], ['^run ×', 'серия ×'],
  ['^(\\d+) separators$', '$1 разделителей'], ['^(\\d+) distinct characters$', '$1 разных символов'],
  ['^emoticon ', 'смайл '], ['^number ', 'число '], ['^repeated letters$', 'повторы букв'], ['^UQ\\+sequence ', 'UQ+лесенка '],
];

export const CHECKER = {
  en: {
    title: 'TON Address Beauty — check any TON wallet address',
    ogTitle: 'TON Address Beauty',
    desc: 'Paste a TON address to see its hidden words and patterns, how interesting, good-looking and meme-worthy it is, and how rare.',
    h1: 'TON Address Beauty',
    sub: 'Paste a wallet address and see which words and patterns hide in it, how interesting, good-looking and meme-worthy it is, and how rarely that happens by chance. The address isn\'t sent anywhere: everything runs in this tab.',
    lang: '<a href="ru/" hreflang="ru" lang="ru">Русский</a>',
    addrLabel: 'TON address (48 characters, UQ… or EQ…)',
    btnCheck: 'Check',
    btnRandom: 'Random',
    points: 'points',
    huntTitle: 'Search right in your browser',
    huntText: 'In 10 seconds this tab checks a couple of hundred thousand random addresses and shows the most interesting one. These addresses have no keys, it\'s only a demo. The GPU generator checks tens of millions of addresses per second, with real keys.',
    huntBtn: 'Search for 10 seconds',
    exTitle: 'Examples',
    exText: 'Addresses from a test run of the generator; their keys were destroyed, do not send money to them.',
    howTitle: 'How it is scored',
    howText: 'The address is split into words using an English frequency dictionary (wordfreq). Every character of a random address is 5 bits of noise; a word "saves" bits when it is shorter than its frequency cost. Bonuses go to separation (separators, letter-case contrast), a phrase at the end, a word right after UQ, stretched letters, emoticons and meme numbers. Points = bits × 10, so <b>+10 points ≈ half as likely</b>.',
    t1: 'one word plus a rarity (stretch, repeats)',
    t2: 'a word pair at the end',
    t3: 'three or more words',
    ts: 'a word right after UQ plus an ending',
    tm: 'a stretched word anywhere',
    taste: 'The taste is tuned to the author: crypto slang, memes, swearing in English and in transliteration. Rarity is based on 2 million random addresses and hundreds of billions of addresses checked by the <a href="https://github.com/pkmt-commits/ton-meme-vanity">ton-meme-vanity</a> generator, where you can also hunt for your own address on a GPU, or <a href="generate.html">right in your browser</a>.',
    locale: 'en-US', dec: '.', oneIn: '1 in ', almostAll: 'almost every address',
    units: [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']],
    verdicts: ['A legendary address — nobody believes it is real', 'An exceptional address', 'Very good-looking and rare', 'A good-looking meme address', 'There is something to see', 'Almost ordinary', 'An ordinary random address'],
    rareMost: 'Most addresses score this much.',
    rareHtml: 'Scoring this high: <b>{n}</b> random addresses.',
    noWords: 'no words found',
    noteChanged: 'Shown in the UQ (url-safe) form, the way wallets display it. In the EQ form the last three characters are a different checksum, so its score may differ.',
    noteTestnet: 'This is a testnet address.',
    errLen: 'An address needs 48 characters: letters, digits, - and _ (or + and /).',
    errChars: 'The address contains invalid characters.',
    errCrc: 'The checksum doesn\'t match: there is a typo in the address.',
    errWc: 'This address is not in the basechain (workchain 0). The page only scores regular addresses.',
    huntProgress: 'Addresses checked: {n} ({r} per second). Best score so far: {s}.',
    huntDone: ' It is shown above. It has no key, so never send money to it.',
    reasons: [],
  },
  ru: {
    title: 'Красота TON-адреса',
    ogTitle: 'Красота TON-адреса',
    desc: 'Вставь TON-адрес — покажет спрятанные слова и узоры, насколько адрес интересный, красивый и мемный и как редко такое выпадает.',
    h1: 'Красота TON-адреса',
    sub: 'Вставь адрес кошелька — покажу, какие слова и узоры в нём прячутся, насколько он интересный, красивый и мемный и как редко такое выпадает случайно. Адрес никуда не отправляется: всё считается в этой вкладке.',
    lang: '<a href="../?lang=en" hreflang="en" lang="en">English</a>',
    addrLabel: 'TON-адрес (48 символов, вид UQ… или EQ…)',
    btnCheck: 'Оценить',
    btnRandom: 'Случайный',
    points: 'очков',
    huntTitle: 'Поиск прямо в браузере',
    huntText: 'За 10 секунд вкладка переберёт пару сотен тысяч случайных адресов и покажет самый интересный. У этих адресов нет ключей — это только демонстрация. Генератор на видеокарте проверяет десятки миллионов адресов в секунду, уже с настоящими ключами.',
    huntBtn: 'Искать 10 секунд',
    exTitle: 'Примеры',
    exText: 'Адреса из тестового прогона генератора; ключи от них уничтожены — не отправляйте на них деньги.',
    howTitle: 'Как считается',
    howText: 'Адрес разбивается на слова по частотному словарю английского (wordfreq). Каждый символ случайного адреса — это 5 бит шума; слово «экономит» биты, если оно короче, чем стоит по частоте. Бонусы — за обособленность (разделители, контраст регистра), фразу в конце, слово сразу после UQ, растяжки, смайлы и мем-числа. Очки = биты × 10, поэтому <b>+10 очков ≈ вдвое реже</b>.',
    t1: 'одно слово плюс редкость (растяжка, повторы)',
    t2: 'пара слов на конце',
    t3: 'три слова и больше',
    ts: 'слово сразу после UQ плюс конец',
    tm: 'растянутое слово где угодно',
    taste: 'Вкус настроен под автора: крипто-сленг, мемы, мат на английском и в транслите. Редкость посчитана по 2 млн случайных адресов и сотням миллиардов адресов, проверенных генератором <a href="https://github.com/pkmt-commits/ton-meme-vanity">ton-meme-vanity</a> — там же можно искать свой красивый адрес на видеокарте, а можно <a href="generate.html">прямо в браузере</a>.',
    locale: 'ru-RU', dec: ',', oneIn: '1 из ', almostAll: 'почти у каждого',
    units: [[1e12, 'трлн'], [1e9, 'млрд'], [1e6, 'млн'], [1e3, 'тыс.']],
    verdicts: ['Легендарный адрес — в такое не верят', 'Исключительный адрес', 'Очень красивый и редкий', 'Красивый, мемный адрес', 'Есть на что посмотреть', 'Почти обычный', 'Обычный случайный адрес'],
    rareMost: 'Такие очки набирает большинство адресов.',
    rareHtml: 'Набрать столько очков: <b>{n}</b> случайных адресов.',
    noWords: 'слов не нашлось',
    noteChanged: 'Показан вид UQ (url-safe), как адрес показывают кошельки. В виде EQ последние три символа — другая контрольная сумма, поэтому оценка у них может отличаться.',
    noteTestnet: 'Это адрес тестовой сети.',
    errLen: 'Нужен адрес из 48 символов: буквы, цифры, - и _ (или + и /).',
    errChars: 'В адресе есть лишние символы.',
    errCrc: 'Контрольная сумма не сходится — в адресе опечатка.',
    errWc: 'Это адрес не в основной цепочке (workchain 0). Страница оценивает только обычные адреса.',
    huntProgress: 'Проверено адресов: {n} ({r} в секунду). Лучший пока набрал очков: {s}.',
    huntDone: ' Он показан выше. Ключа у него нет — переводить на него нельзя.',
    reasons: REASONS_RU,
  },
};

export const GENERATOR = {
  en: {
    title: 'TON Vanity Address Generator — in your browser',
    ogTitle: 'TON Vanity Address Generator',
    desc: 'Find an eye-catching TON wallet address right in your browser: keys are created on your device, addresses with words and phrases, importable into MyTonWallet.',
    h1: 'Get an eye-catching TON address',
    sub: 'This page searches keys right in your browser and keeps addresses with visible words and phrases: interesting, good-looking, meme-worthy. Keys are created on this device and never sent anywhere. A found wallet imports into MyTonWallet.',
    lang: '<a href="ru/generate.html" hreflang="ru" lang="ru">Русский</a>',
    btnGo: 'Start search',
    btnStop: 'Stop',
    threads: 'Threads',
    versions: 'Wallet versions',
    verW5: 'W5 only',
    statN: 'addresses checked',
    statR: 'per second',
    statT: 'time',
    statB: 'best, points',
    statusIdle: 'Press "Start search". The longer you search, the better the best address gets: every +10 points is about half as likely.',
    bestTitle: 'Best finds',
    listEmpty: 'Addresses scoring 120+ appear here, usually within the first seconds.',
    secTitle: 'Security',
    sec1: 'A key is access to money. It is made by your browser\'s random number generator and kept only in this tab\'s memory: close the tab and the key is gone unless you saved it.',
    sec2: 'Whoever controls this page\'s code could tamper with key generation. For significant amounts, save the page (Ctrl+S), go offline and search offline, or use the GPU generator from the <a href="https://github.com/pkmt-commits/ton-meme-vanity">repository</a> — the code is open.',
    sec3: 'A copied key stays in the clipboard history (Windows: Win+V), so clear it after importing. Before sending a significant amount, compare the address in the wallet character by character and send a little first.',
    howTitle: 'How to set up a found wallet',
    how1: 'In MyTonWallet: add wallet → <b>Import from Secret Words</b>.',
    how2: 'Paste the key (64 characters) into the <b>first word</b> field, with no spaces or line breaks.',
    how3: 'If the find\'s version is not W5: Settings → <b>Wallet Versions</b> → pick it.',
    how4: 'Compare the address with the found one character by character.',
    units: [[1e9, ' B'], [1e6, ' M'], [1e3, ' K']], dec: '.',
    btnShowKey: 'Show key',
    btnCopyAddr: 'Copy address',
    btnCopyKey: 'Copy key',
    keyNote: 'This is a private key (seed). Never show or send it to anyone. ',
    switchVer: 'After importing, switch the version to <b>{v}</b>.',
    copied: 'Copied',
    copyManual: 'Select and copy it manually',
    statusRunning: 'Self-test and search… You can minimize the tab, but don\'t close it.',
    btnContinue: 'Continue search',
    statusStopped: 'Search stopped. Found keys live only while the tab is open, so save the one you want.',
    errStart: 'Could not start the search',
    errKeys: 'The key self-test failed: do not use this page in this browser.',
    errAddr: 'The address self-test failed: do not use this page in this browser.',
    reasons: [],
  },
  ru: {
    title: 'Свой красивый TON-адрес',
    ogTitle: 'Свой красивый TON-адрес',
    desc: 'Поиск красивого TON-адреса прямо в браузере: ключи создаются на вашем устройстве, адреса со словами и фразами — для MyTonWallet.',
    h1: 'Свой красивый TON-адрес',
    sub: 'Страница перебирает ключи прямо в вашем браузере и оставляет адреса, в которых видны слова и фразы: интересные, красивые, мемные. Ключи создаются на этом устройстве и никуда не отправляются. Найденный кошелёк импортируется в MyTonWallet.',
    lang: '<a href="../generate.html?lang=en" hreflang="en" lang="en">English</a>',
    btnGo: 'Начать поиск',
    btnStop: 'Остановить',
    threads: 'Потоков',
    versions: 'Версии кошелька',
    verW5: 'только W5',
    statN: 'адресов проверено',
    statR: 'в секунду',
    statT: 'время',
    statB: 'лучший, очков',
    statusIdle: 'Нажмите «Начать поиск». Чем дольше поиск, тем красивее лучший адрес: каждые +10 очков встречаются примерно вдвое реже.',
    bestTitle: 'Лучшие находки',
    listEmpty: 'Здесь появятся адреса с очками от 120 — обычно в первые секунды.',
    secTitle: 'Безопасность',
    sec1: 'Ключ — это доступ к деньгам. Он создаётся генератором случайных чисел браузера и хранится только в памяти этой вкладки: закроете вкладку — ключ пропадёт, если вы его не сохранили.',
    sec2: 'Кто управляет кодом страницы, мог бы подменить генерацию. Для заметных сумм сохраните страницу (Ctrl+S), отключите интернет и ищите офлайн, либо используйте генератор на видеокарте из <a href="https://github.com/pkmt-commits/ton-meme-vanity">репозитория</a> — код открыт.',
    sec3: 'Скопированный ключ остаётся в журнале буфера обмена (Windows: Win+V) — очистите его после импорта. Перед переводом заметной суммы сверьте адрес в кошельке символ в символ и отправьте сначала немного.',
    howTitle: 'Как завести найденный кошелёк',
    how1: 'В MyTonWallet: добавить кошелёк → <b>Import from Secret Words</b>.',
    how2: 'В поле <b>первого слова</b> вставьте ключ (64 символа) — без пробелов и переноса строки.',
    how3: 'Если у находки версия не W5: Настройки → <b>Wallet Versions</b> → выберите её.',
    how4: 'Сверьте адрес с найденным символ в символ.',
    units: [[1e9, ' млрд'], [1e6, ' млн'], [1e3, ' тыс.']], dec: '.',
    btnShowKey: 'Показать ключ',
    btnCopyAddr: 'Копировать адрес',
    btnCopyKey: 'Копировать ключ',
    keyNote: 'Это приватный ключ (сид). Никому не показывайте и не отправляйте. ',
    switchVer: 'После импорта переключите версию на <b>{v}</b>.',
    copied: 'Скопировано',
    copyManual: 'Выделите и скопируйте вручную',
    statusRunning: 'Самопроверка и поиск… Вкладку можно свернуть, но не закрывать.',
    btnContinue: 'Продолжить поиск',
    statusStopped: 'Поиск остановлен. Найденные ключи живут, пока открыта вкладка — сохраните нужный.',
    errStart: 'Не удалось запустить поиск',
    errKeys: 'Самопроверка ключей не прошла — не используйте эту страницу в этом браузере.',
    errAddr: 'Самопроверка адресов не прошла — не используйте эту страницу в этом браузере.',
    reasons: REASONS_RU,
  },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// fills {{key}} (HTML, trusted strings) and `/*T*/null` (the page's strings as JSON)
export function localize(tpl, dict) {
  const out = tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => { if (!(k in dict)) throw new Error('i18n: no string ' + k); return dict[k]; })
    .replace('/*T*/null', () => JSON.stringify(dict).replace(/<\//g, '<\\/'));
  if (/\{\{\w+\}\}/.test(out)) throw new Error('i18n: unfilled placeholder');
  return out;
}

// <head> for a page: title, description, Open Graph (absolute URLs for Telegram/Twitter previews), hreflang, language redirect
export function pageHead({ lang, dict, file }) {
  const enUrl = SITE + (file === 'index.html' ? '' : file), ruUrl = SITE + 'ru/' + (file === 'index.html' ? '' : file);
  const url = lang === 'ru' ? ruUrl : enUrl;
  // an English page opened from a Russian browser goes to the Russian one, unless the visitor chose English (?lang=en)
  const redirect = lang === 'en'
    ? `<script>try{var q=/[?&]lang=en\\b/.test(location.search);if(q)localStorage.setItem('lang','en');if(!q&&localStorage.getItem('lang')!=='en'&&/^ru\\b/i.test(navigator.language||''))location.replace('ru/'+location.pathname.split('/').pop()+location.hash)}catch(e){}</script>`
    : `<script>try{localStorage.removeItem('lang')}catch(e){}</script>`;
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(dict.title)}</title>
<meta name="description" content="${esc(dict.desc)}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="en" href="${enUrl}">
<link rel="alternate" hreflang="ru" href="${ruUrl}">
<link rel="alternate" hreflang="x-default" href="${enUrl}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(dict.ogTitle)}">
<meta property="og:description" content="${esc(dict.desc)}">
<meta property="og:image" content="${SITE}social-preview.png">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="640">
<meta property="og:locale" content="${lang === 'ru' ? 'ru_RU' : 'en_US'}">
<meta name="twitter:card" content="summary_large_image">
${redirect}`;
}
