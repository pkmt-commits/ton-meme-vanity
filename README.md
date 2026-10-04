# TON Vanity — «смешные» адреса TON-кошелька на видеокарте

<p align="center"><img src="docs/social-preview.png" alt="UQDurov… — пример смешного TON-адреса" width="760"></p>

[![CI](https://github.com/pkmt-commits/ton-meme-vanity/actions/workflows/ci.yml/badge.svg)](https://github.com/pkmt-commits/ton-meme-vanity/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/GPU-NVIDIA%20CUDA-76B900)
![TON](https://img.shields.io/badge/TON-W5%20(v5r1)-0098EA)

**EN, in short:** a CUDA vanity-address generator for TON wallets (W5 / v5r1, `UQ…`). Instead of hunting for one fixed
suffix, it scores every address for *funny readable phrases* (`…wen_LAMBO`, `…rug-PULL`, `UQBOOM…REKT`) and sends
the best ones to Telegram. Every key is re-verified with the official `@ton/ton` library.
Requirements: NVIDIA GPU, Node.js 20+, CUDA Toolkit, and on Windows the Visual Studio 2022 Build Tools (C++).

```
npm run setup     # checks the toolchain, detects your GPU, builds the kernel, self-tests it against @ton/ton
npm run hunt      # start hunting (Ctrl+C to stop); found keys go to gems.jsonl — never share that file
npm run top       # best addresses found so far, without keys
```

**Why not just a mask?** Fixed-mask generators are practically limited to 6–8 characters: every extra letter costs ~32x more
attempts. This one accepts thousands of words and word pairs at once, so it keeps finding 2–3-word phrases of 9–12 characters
(`…Y3ah2goaT` = "yeah 2 goat") that would take ~10^14 attempts to hit on purpose — the examples in this README came from
a single 44-second test run. The trade-off: you can't order a specific phrase — you pick from what turns up.

**Raw keys, not 24 words.** A TON key from a 24-word phrase costs 100,000 PBKDF2-HMAC-SHA512 iterations (and only ~1 in 256
random phrases is valid), so phrase-based generators are roughly 1000x slower. Here raw ed25519 seeds are searched directly:
millions of addresses per second on modern NVIDIA GPUs. Found keys import into MyTonWallet (tested); wallets that accept only
24 words (e.g. Tonkeeper) can't import them.

Using an AI coding agent? Point it at [AGENTS.md](AGENTS.md). Docs and code comments are in Russian.

---

Обычный vanity-генератор ищет заданное окончание (`…_DUROV`). Этот ищет адреса, в которые знающий человек
**не поверит, что они случайные**: слова и фразы на конце (`…NGMI-ser`, `…good_JOB`), мемное слово сразу после
`UQ`, растяжки (`Swwwwwwag`), смайлы на контрасте регистра (`-_-`, `o_O`), мем-числа (`420`, `69`, `67`),
«адрес из документации» (`UQABCDEF…`, `UQAAAAAA…`).

## Чем отличается

### 1. Фразы, а не маска

Генератор по маске ищет одно заданное окончание. Каждая лишняя буква — примерно в 32 раза больше попыток,
поэтому на практике маска ограничена 6–8 символами (`…_durov`, `…moon`).

Здесь засчитываются **тысячи слов и их сочетаний одновременно**. Поэтому постоянно находятся фразы из 2–3 слов длиной
9–12 символов, которые по маске искать бесполезно:

| Окончание | Читается как | Найти именно его по маске | Время поиска по маске¹ |
|---|---|---|---|
| `…Y3ah2goaT` | yeah 2 goat | ~140 трлн попыток | от 2 месяцев до года с лишним |
| `…x4xa_0kUSh` | xaxa kush | ~9 000 трлн попыток | от 10 до 70 лет |

**Оба адреса (и все примеры ниже) найдены за один тестовый прогон длиной 44 секунды** на одной домашней видеокарте —
вместе с ещё полусотней находок.

¹ При 4–30 млн адресов/с — грубая оценка для современных видеокарт NVIDIA, от среднего класса до топовых
(точную скорость вашей покажет `npm run bench`).

Цена подхода: **конкретную фразу заказать нельзя**, вы выбираете из того, что выпало (бот присылает лучшее).
Если нужно именно своё короткое окончание, есть режим `--suffix` (см. ниже).

### 2. Перебираются ключи, а не фразы из 24 слов

Ключ от фразы из 24 слов TON получает через PBKDF2-HMAC-SHA512 со **100 000 итераций**, а из случайных фраз подходит только
~1 из 256 (ещё по 390 итераций на проверку). Итого ~400 000 вычислений SHA-512 на **каждый** ключ — генераторы, которые
перебирают фразы, примерно в тысячу раз медленнее.

Здесь перебираются сами приватные ключи (32-байтные сиды ed25519): один SHA-256, один SHA-512 и одно умножение
на эллиптической кривой на ключ. Поэтому и скорость — миллионы адресов в секунду.

Обратная сторона: **24 слов у найденного кошелька нет**, есть приватный ключ. Его импорт проверен и работает
в **MyTonWallet** (октябрь 2026, см. «Как завести найденный кошелёк»). Кошельки, которые принимают только 24 слова
(например, Tonkeeper), такой ключ не импортируют.

## Как это работает

Видеокарта перебирает ключи и грубым ситом отбирает примерно 1 адрес из 10 000. Node-обёртка точно оценивает каждого
кандидата, сохраняет хорошие (с ключом, только у вас на диске) и раз в несколько минут присылает в Telegram лучший
за это время — с кнопками 👍 / 😐 / 👎 / ⭐.

```
cuda/vanity  (видеокарта: ed25519 seed → pubkey → адрес W5, сито по словам и узорам)
   └─ печатает "HIT <seedHex> <адрес>"
src/run_cuda.mjs (обёртка + дашборд)
   ├─ scoreV5(адрес) — точная оценка
   ├─ оценка ≥ --save-min → проверка ключа официальной @ton/ton → gems.jsonl (С КЛЮЧОМ)
   └─ лучший за окно → Telegram (ТОЛЬКО адрес) → кнопка ⭐ → favorites.jsonl
```

## Быстрый старт

Нужно: видеокарта NVIDIA, Windows 10/11 (Linux должен работать, но не проверялся).

1. Поставьте [Node.js](https://nodejs.org) LTS, [драйвер NVIDIA](https://www.nvidia.com/drivers),
   [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads) и (только Windows)
   [Build Tools for Visual Studio 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/) с компонентом
   «Разработка классических приложений на C++».
2. В папке проекта:
   ```
   npm run setup
   ```
   Скрипт сам проверит всё нужное, определит модель видеокарты, соберёт ядро и прогонит самопроверку.
   Если чего-то не хватает — напишет, что поставить. Можно запускать повторно.
3. Охота:
   ```
   npm run hunt        (Ctrl+C — стоп)
   npm run top         (лучшие найденные адреса, без ключей)
   ```

Пример `npm run top` (адреса из тестового прогона; ключи от них уничтожены — не отправляйте на них деньги):

```
  227  T1:aaaaass                  UQBHZEO8PZ60426yiseuBbJBfSoICVT7TWBuMzW-Baaaaass
  215  T2:Y3ah_goaT                UQC5PS0DCjuLHTFvAy-2WB3TfV5utOrqSHWmBNxY3ah2goaT
  198  T2:x4xa_kUSh                UQDzdCq-qAR68Lq6KvweGQNDBsYUSVHSo96d25x4xa_0kUSh
  191  TS:BLyA_…_poor              UQBLyA25xBc6o4Xwq7ZqJvtQ3HDPsgd4xiOXS7xtf219poor
  191  TS:AaPed_…_farm             UQAaPed5QqrkzPoCcm2zpdnWiTx9tfsMfILIk9Gd5-KNfarm
  190  TM:butt4                    UQBUTTTTqcNR3XnNdRr_kWZyjMbZYYTCdkRNevbpAQQ7G7qP
```

Метки: `T1` — одно слово с «редкостью» (растяжка, повторы), `T2` — пара слов на конце, `T3` — три и больше,
`TS` — слово сразу после `UQ` + конец, `TM` — растянутое слово где угодно.

Работает с AI-агентом (Claude Code, Codex, Cursor и др.): дайте ему ссылку на репозиторий и попросите
«установи и запусти по AGENTS.md».

## Что проверяется

| Проверка | Как запустить |
|---|---|
| Ядро считает pubkey и адрес так же, как официальная `@ton/ton` (20 тестовых сидов) | `npm run selftest` (входит в setup) |
| Быстрый детектор слов на видеокарте == эталонный, на миллионах адресов | `node scripts/kernel.mjs validate 15` (короткая версия входит в setup) |
| Быстрый путь адреса в Node == `@ton/ton`, 3000 случайных сидов | `npm run smoke` |
| Каждый сохранённый ключ | перепроверяется `@ton/ton` перед записью, расхождения видны на дашборде (должно быть 0) |
| Скорость вашей карты | `npm run bench` |

Проверено автором на Windows 11 с RTX 3080 Ti.

## Сколько это стоит по времени

Каждая буква точного окончания (регистр не важен) встречается примерно в 32 раза реже, разделитель `-`/`_` или
цифра — в 64 раза. Нужное число попыток для одного конкретного окончания:

| Окончание | Пример | Попыток в среднем |
|---|---|---|
| 4 буквы | `…moon` | 1 млн |
| 5 букв | `…durov` | 34 млн |
| 6 букв | `…degens` | 1 млрд |
| `_` + 6 букв | `…_valera` | 69 млрд |
| 8 букв | `…lambolol` | 1.1 трлн |
| 9 букв | `…moontoday` | 35 трлн |

Время = попытки ÷ скорость вашей карты (`npm run bench`, адресов в секунду). Грубо: современные видеокарты NVIDIA дают
от ~4 млн (средний класс) до ~30 млн (топовые) адресов в секунду.

Режим «смешных адресов» ловит одновременно тысячи слов и пар слов, поэтому хорошие находки идут постоянно.
А вот лучший адрес растёт медленно: в 30 раз больше перебора — это примерно одна лишняя «удачная буква».

## Безопасность — прочитайте

- **Ключи создаются и остаются только у вас.** В сеть уходит только адрес (в Telegram). Сид — 32 байта
  ed25519, тот же формат, что в официальных библиотеках TON.
- **`gems.jsonl` и `favorites.jsonl` содержат приватные ключи** (`seedHex`, `secretKeyHex`). Это доступ
  к кошелькам. Не показывайте, не коммитьте (они в `.gitignore`), не вставляйте в чаты и в ИИ-ассистенты.
  Смотреть находки безопасно так: `npm run top` — он печатает только адреса.
- **Как получается ключ.** Сид = `SHA-256(база ‖ номер)`: база — 32 случайных байта из системного
  криптогенератора (`std::random_device`: на Windows — `RtlGenRandom`, на Linux — системный источник libstdc++),
  номер — 64-битный счётчик. Утечка одного ключа ничего не говорит о других.
- **История (до публикации, исправлено):** в ранних версиях (1) генератор заводился от 32-битного числа
  (`mt19937`) — ключи можно было перебрать, тот же класс ошибки, что у Profanity (взлом Wintermute, 2022);
  (2) сид был просто `номер ‖ база` — по одному утёкшему ключу находились соседние.
- Перед тем как класть средства, импортируйте кошелёк и **сверьте адрес символ в символ**.
- Это новый кошелёк, которым владеете только вы. Подобрать так чужой кошелёк невозможно: совпадает лишь
  косметическая часть адреса.

## Параметры охоты

`npm run hunt -- --max-temp 75 --per-hour 6` и т.п.:

| Флаг | По умолчанию | Что |
|---|---|---|
| `--max-temp` | 80 | целевая температура видеокарты, °C |
| `--save-min` | 150 | порог оценки для записи в `gems.jsonl` |
| `--per-hour` | 11 | сообщений в Telegram в час (лучший за окно) |
| `--min-bot` | 100 | минимальная оценка для Telegram |
| `--cap` | 25 | сколько хранить адресов с одной меткой |
| `--start-every` | 4 | каждое N-е сообщение — лучший со словом сразу после `UQ` (0 — выкл) |

**Термозащита.** Ядро само держит температуру: регулирует долю нагрузки, при цель+5°C полностью встаёт до
цель−6°C, при цель+10°C (но не выше 90°C) или отказе датчика останавливается. Без NVML (часть драйвера) не
запускается. Если карта греется сильно — поднимите обороты вентиляторов и/или снизьте Power Limit
(например, MSI Afterburner): скорость почти не падает.

**Точное окончание** вместо «смешных» адресов:
```
node scripts/kernel.mjs --suffix _durov > hits.txt    (в файле КЛЮЧИ; Ctrl+C — стоп)
node src/check_hits.mjs hits.txt                       (сверка с @ton/ton, ключи не печатает)
```

Служебные режимы ядра (`node scripts/kernel.mjs <режим>`): `selftest <файл сидов>`, `validate N`,
`stats N` (частоты правил сита), `bench N`.

## Telegram (по желанию)

1. Создайте бота у [@BotFather](https://t.me/BotFather) и напишите ему любое сообщение.
2. Скопируйте `telegram.config.example.json` → `telegram.config.json`, впишите `token`.
3. `npm run telegram-setup` — найдёт ваш `chatId`, впишет его в конфиг и пришлёт тестовое сообщение.

Или задайте переменные `TG_BOT_TOKEN`, `TG_CHAT_ID`. Если Telegram открывается только через прокси —
переменная `HTTPS_PROXY` или системный прокси Windows (подхватывается сам).

Кнопки: 👍 / 😐 / 👎 пишутся в `data/taste/reactions.jsonl` (материал для своей подстройки оценки),
⭐ копирует запись с ключом в `favorites.jsonl`.

## Как завести найденный кошелёк

Ключ — сырой сид, 24 слов для него нет. Проверено с **MyTonWallet** (октябрь 2026 — импорт работает без проблем):

1. Добавить кошелёк → **Import from Secret Words**.
2. В поле **первого слова** вставьте `seedHex` (64 hex-символа) нужной записи. Без пробелов и переноса
   строки, иначе будет «непредвиденная ошибка».
3. Кошелёк должен показать **ровно тот же адрес** `uq`. Сверьте и только потом переводите средства.

## Настройка вкуса

Оценка подогнана под вкус автора: мат (en + рус. транслит), крипто-сленг, рофлы, ирония. Свой вкус:

- `src/words_curated.mjs` — отборные слова и любимые темы (получают бонус). Правьте свободно.
- `src/gems.mjs` → `SLANG` — сленг; `node -e "import('./src/gems.mjs').then(m=>m.writeWordsHeader())"`
  пересобирает словарь видеокарты `cuda/words.h`, затем `npm run setup -- --force`.
- `data/word_votes.json` — оценки слов автором (`1` / `0` / `-1`). Удалите файл — оценка станет нейтральнее.
- `src/score_v5.mjs` → `P5` — веса. Как устроено: адрес разбивается на слова по частотному словарю,
  выигрыш слова = 5 бит × длина − цена слова по частоте; плюс бонусы за темы, обособленность (разделители,
  контраст регистра), фразу на конце, слово после `UQ`, растяжки, смайлы, мем-числа.

## Файлы

| Путь | Что |
|---|---|
| `scripts/setup.mjs` | проверка окружения, сборка, самопроверка |
| `cuda/vanity.cu` | ядро: ed25519 (fixed-base comb, пакетное обращение Монтгомери), SHA-256/512, адрес W5, термо-регулятор |
| `cuda/detector_words.inc` | правила сита на видеокарте (быстрая и эталонная версии) |
| `cuda/words.h`, `base_table.h`, `sha_const.h`, `calib.h` | сгенерированные таблицы (`src/gems.mjs`, `cuda/gen_*.mjs`, `ref/calib.mjs`) |
| `src/run_cuda.mjs` | обёртка: оценка, сохранение, Telegram, дашборд |
| `src/score_v5.mjs` | оценка «смешности» |
| `src/verify.mjs`, `src/check_hits.mjs` | независимая проверка ключей официальной `@ton/ton` |
| `scripts/top.mjs` | просмотр находок без ключей |
| `tests/` | автотесты оценки и адреса (`npm test`, видеокарта не нужна) |
| `data/en_zipf.tsv` | частоты английских слов |

## Лицензии и благодарности

- Код — [MIT](LICENSE).
- `data/en_zipf.tsv` — выборка из [wordfreq](https://github.com/rspeer/wordfreq) (Robyn Speer), данные под
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); файл распространяется на тех же условиях.
- [`@ton/ton`, `@ton/core`, `@ton/crypto`](https://github.com/ton-org), [tweetnacl](https://github.com/dchest/tweetnacl-js),
  [noble-curves](https://github.com/paulmillr/noble-curves).
- Идея оценки «неслучайности» — из wordninja и детекторов DGA-доменов.

Используйте на свой риск. Это не финансовый совет и не аудированный криптографический продукт.
