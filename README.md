# TON Meme Vanity — GPU vanity address generator for TON wallets

<p align="center"><img src="docs/social-preview.png" alt="UQDurov… — an example of a meme TON address" width="760"></p>

[![CI](https://github.com/pkmt-commits/ton-meme-vanity/actions/workflows/ci.yml/badge.svg)](https://github.com/pkmt-commits/ton-meme-vanity/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/GPU-NVIDIA%20CUDA-76B900)
![TON](https://img.shields.io/badge/TON-W5%20(v5r1)-0098EA)

**[Try it in your browser — no GPU, no install →](https://pkmt-commits.github.io/ton-meme-vanity/generate.html)** ·
[Address checker](https://pkmt-commits.github.io/ton-meme-vanity/) · [Русская версия](README.ru.md) ·
[AGENTS.md](AGENTS.md) for AI coding agents

A vanity address generator for TON wallets (W5 / v5r1, V4R2, V3R2, V3R1) that runs on NVIDIA GPUs (CUDA) or right in
your browser. A normal vanity generator looks for one fixed ending (`…_DUROV`). This one scores **every** address for
things nobody would believe are random:

- readable phrases at the end (`…NGMI-ser`, `…good_JOB`);
- a meme word right after `UQ`;
- stretched letters (`Swwwwwwag`);
- emoticons that stand out by letter case (`-_-`, `o_O`);
- meme numbers (`420`, `69`, `67`);
- "documentation-looking" addresses (`UQABCDEF…`, `UQAAAAAA…`).

The best finds go to your Telegram. Every key is re-checked with the official `@ton/ton` library before it is saved,
and keys never leave your machine.

## No GPU? Use the browser version

**[TON vanity generator in your browser](https://pkmt-commits.github.io/ton-meme-vanity/generate.html)** runs the same
search on your CPU. Keys are created on your device and never sent anywhere. An ordinary computer checks hundreds of
thousands of addresses per second and finds a ~200-point address in a few minutes; it works on phones too. Found keys
import into MyTonWallet (tested). Built with `npm run build:generator` into `docs/generate.html`.

**[Address checker](https://pkmt-commits.github.io/ton-meme-vanity/)**: paste any TON address to see its hidden words
and patterns, how interesting, good-looking and meme-worthy it is, and how rare such an address is. Everything is
computed in the browser. Built with `npm run build:checker` into `docs/index.html`.

## Quick start (GPU)

You need an NVIDIA GPU, [Node.js](https://nodejs.org) 20+, an [NVIDIA driver](https://www.nvidia.com/drivers), the
[CUDA Toolkit](https://developer.nvidia.com/cuda-downloads) and, on Windows,
[Build Tools for Visual Studio 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with
"Desktop development with C++". Tested by the author on Windows 11 with an RTX 3080 Ti; Linux should work (the kernel
compiles in CI).

```
npm run setup     # checks the toolchain, detects your GPU, builds the kernel, self-tests it against @ton/ton
npm run hunt      # start hunting (Ctrl+C to stop); found keys go to gems.jsonl — never share that file
npm run top       # best addresses found so far, without keys
```

`npm run setup` is safe to run again; if something is missing, it tells you what to install.

Using an AI coding agent (Claude Code, Codex, Cursor, …)? Give it the repository link and ask it to
"install and run this following AGENTS.md".

## What makes it different

### 1. Phrases, not a mask

A mask generator looks for one fixed ending. Every extra letter costs ~32x more attempts, so in practice a mask is limited
to 6–8 characters (`…_durov`, `…moon`).

Here **thousands of words and word combinations count at once**, so 2–3-word phrases of 9–12 characters keep turning up,
the kind that is hopeless to hunt with a mask:

| Ending | Reads as | Attempts to hit it with a mask | Time with a mask¹ |
|---|---|---|---|
| `…Y3ah2goaT` | yeah 2 goat | ~140 trillion | one to six months |
| `…x4xa_0kUSh` | xaxa kush | ~9,000 trillion | 5 to 35 years |

**Both addresses (and every example below) came from a single 44-second test run** on one home GPU, together with
some fifty other finds.

¹ At 8–60 million addresses per second, a rough range for current NVIDIA cards from mid-range to high-end
(`npm run bench` shows yours).

The trade-off: **you can't order a specific phrase**, you pick from what turns up (the bot sends you the best).
If you need your own short ending, there is a `--suffix` mode (see below).

### 2. Raw keys, not 24-word phrases

TON turns a 24-word phrase into a key with PBKDF2-HMAC-SHA512 and **100,000 iterations**, and only ~1 in 256 random
phrases is valid (another 390 iterations per check). That is ~400,000 SHA-512 computations for **every** key, so
generators that search phrases are roughly a thousand times slower.

Here raw private keys (32-byte ed25519 seeds) are searched directly: one SHA-256, one SHA-512 and one elliptic-curve
multiplication per key (16 point additions with a 60 MB table in GPU memory). That is why it does tens of millions of
addresses per second.

The flip side: **a found wallet has no 24 words**, only a private key. Importing it works in **MyTonWallet**
(tested in October 2026, see [Importing a found wallet](#importing-a-found-wallet)). Wallets that accept only 24 words
(e.g. Tonkeeper) can't import it.

### 3. Up to four addresses per key

The wallet address depends on the contract version as well as on the key. With `--versions 4` every key is checked as a
**W5, V4R2, V3R2 and V3R1** wallet. An extra version costs two SHA-256 instead of another curve multiplication, so you
get ~2.2x more addresses per second. MyTonWallet lists all four versions of an imported key
(Settings → Wallet Versions) and switches between them; importing all four was tested by hand (October 2026).
The default is W5 only, the newest version (it can, for example, pay fees in USDT); V4R2 is also common, V3 versions are
old but work.

## How it works

The GPU searches keys and computes the v5 score of every address itself: the same word segmentation, the same
dictionary (~47k words) and the same weights as the exact score in Node (the "v5-lite sieve"). Only addresses scoring at
least `--save-min − 10` leave the GPU, a few per million. The Node wrapper re-scores them exactly, saves the good ones
(with the key, only on your disk) and every few minutes sends the best one of that slot to Telegram, with
👍 / 😐 / 👎 / ⭐ buttons.

```
cuda/vanity  (GPU: ed25519 seed → pubkey → W5 [+V4R2, V3R2, V3R1] addresses, v5-lite score, patterns)
   └─ prints "HIT <seedHex> <address> <version>"
src/run_cuda.mjs (wrapper + dashboard)
   ├─ scoreV5(address) — the exact score
   ├─ score ≥ --save-min → key re-checked with official @ton/ton → gems.jsonl (WITH THE KEY)
   └─ best of each time slot → Telegram (address ONLY) → ⭐ button → favorites.jsonl
```

**Why the score runs on the GPU.** Earlier versions used separate GPU "word rules" that only loosely resembled the
score. Measured on 200 million random addresses, they passed only ~25% of the addresses the score rates 150+: they
missed 3-letter words split by letter case (`scamKEK`, `L0hRug`), mixed case (`RugWEeD`) and knew 7k words instead of
~47k. The v5-lite sieve matches the exact score within ±2 points for 96–99% of addresses and keeps 99% of the good ones
at the same speed, so about 4x more good finds. To measure it yourself: `node src/recall_sample.mjs 20 sample.jsonl`
(random addresses without keys, on the CPU), then `node src/recall_eval.mjs` on the output of
`node scripts/kernel.mjs flags`.

**How the score works.** It measures "how much less random than noise" an address is, in bits. The address is split
into words using English word frequencies (wordfreq); every random character is 5 bits of noise, and a word "saves" bits
when it is cheaper than its length. Bonuses go to separation (`-`, `_`, letter-case contrast), a phrase at the end, a
word right after `UQ`, stretched letters, emoticons and meme numbers. Score = bits × 10, so **+10 points ≈ half as likely**.

Example `npm run top` (addresses from a test run; their keys were destroyed, do not send money there):

```
  227  T1:aaaaass                  UQBHZEO8PZ60426yiseuBbJBfSoICVT7TWBuMzW-Baaaaass
  215  T2:Y3ah_goaT                UQC5PS0DCjuLHTFvAy-2WB3TfV5utOrqSHWmBNxY3ah2goaT
  198  T2:x4xa_kUSh                UQDzdCq-qAR68Lq6KvweGQNDBsYUSVHSo96d25x4xa_0kUSh
  191  TS:BLyA_…_poor              UQBLyA25xBc6o4Xwq7ZqJvtQ3HDPsgd4xiOXS7xtf219poor
  191  TS:AaPed_…_farm             UQAaPed5QqrkzPoCcm2zpdnWiTx9tfsMfILIk9Gd5-KNfarm
  190  TM:butt4                    UQBUTTTTqcNR3XnNdRr_kWZyjMbZYYTCdkRNevbpAQQ7G7qP
```

Labels: `T1` one word plus a rarity (stretch, repeats), `T2` a word pair at the end, `T3` three or more words,
`TS` a word right after `UQ` plus an ending, `TM` a stretched word anywhere.

## What is verified

| Check | How to run |
|---|---|
| The kernel computes pubkey and address exactly like `@ton/ton` (20 test seeds × 4 wallet versions, with and without the table) | `npm run selftest` (part of setup) |
| The GPU v5-lite sieve equals the exact score in `src/score_v5.mjs` (3,000 addresses with words and phrases) | `node ref/check_v5lite.mjs` (part of setup) |
| The fast GPU pattern/stretch detector equals the reference one on millions of addresses | `node scripts/kernel.mjs validate 15` (a short version is part of setup) |
| The fast Node address path equals `@ton/ton` on 3,000 random seeds | `npm run smoke` |
| Every saved key | re-checked with `@ton/ton` before writing; mismatches are shown on the dashboard (must be 0) |
| Your GPU speed | `npm run bench` |

## How long it takes

Each letter of an exact ending (case-insensitive) is about 32x rarer; a separator `-`/`_` or a digit, about 64x.
Attempts needed on average for one specific ending:

| Ending | Example | Attempts on average |
|---|---|---|
| 4 letters | `…moon` | 1 million |
| 5 letters | `…durov` | 34 million |
| 6 letters | `…degens` | 1 billion |
| `_` + 6 letters | `…_valera` | 69 billion |
| 8 letters | `…lambolol` | 1.1 trillion |
| 9 letters | `…moontoday` | 35 trillion |

Time = attempts ÷ your card's speed (`npm run bench`, addresses per second). Roughly, current NVIDIA cards do from
~8 million (mid-range) to ~60 million (high-end) addresses per second with one wallet version, and about twice as many
with `--versions 4`.

The meme mode catches thousands of words and word pairs at once, so good finds keep coming. The very best address grows
slowly, though: 30x more attempts buys roughly one extra "lucky letter".

## Security — please read

- **Keys are created and stay on your machine.** Only the address goes to the network (Telegram). The seed is a 32-byte
  ed25519 seed, the same format as in the official TON libraries.
- **`gems.jsonl` and `favorites.jsonl` contain private keys** (`seedHex`, `secretKeyHex`). That is access to the wallets.
  Never show them, commit them (they are in `.gitignore`), or paste them into chats or AI assistants. To look at your
  finds safely use `npm run top`, it prints addresses only.
- **How a key is made.** Seed = `SHA-256(base ‖ counter)`: the base is 32 random bytes from the system CSPRNG
  (`std::random_device`: `RtlGenRandom` on Windows, the system source of libstdc++ on Linux), the counter is 64-bit.
  Leaking one key says nothing about the others. Randomness comes straight from the OS (`BCryptGenRandom` /
  `getrandom`), with checks that the base is not zero and does not repeat.
- **GPU memory.** CUDA does not clear memory between processes (`cudaMalloc`: "The memory is not cleared"), and reading
  leftovers of previous programs is a known technique. The kernel wipes found seeds right after handing them over and
  the base on exit. If the hunt is killed forcibly, the last base may stay in GPU memory until a reboot, so reboot after
  hunting on a shared or someone else's computer.
- **History (before publication, fixed):** in early versions (1) the generator was seeded from a 32-bit number
  (`mt19937`), so keys could be brute-forced, the same class of bug as Profanity (the 2022 Wintermute hack);
  (2) the seed was simply `counter ‖ base`, so one leaked key exposed its neighbours.
- Before sending funds, import the wallet and **compare the address character by character**.
- This is a new wallet that only you own. You can't get someone else's wallet this way: only the cosmetic part of the
  address matches.

## Importing a found wallet

The key is a raw seed; there are no 24 words for it. Tested with **MyTonWallet** (October 2026, import works fine):

1. Add wallet → **Import from Secret Words**.
2. Paste the record's `seedHex` (64 hex characters) into the **first word** field. No spaces or line breaks, otherwise
   you get an "unexpected error".
3. The wallet must show **exactly the same address** `uq`. Compare it, and only then send funds.
   Clipboard: a copied seed stays in Windows clipboard history (Win+V) and, with "Sync across devices" on, goes to the
   Microsoft cloud; phone keyboards remember pasted text too. Clear the history after importing (Win+V → Clear all) or
   type the key without the clipboard.
4. If the record's `ver` is not `W5` (hunting with `--versions 4`): after importing open **Settings → Wallet Versions**
   and pick that version (`V4R2`, `V3R2` or `V3R1`); the wallet switches to the right address. Compare it too.

How the address looks in different places:

- The meme ending is visible in the `UQ…` form (wallets show wallet addresses this way). In the bounceable `EQ…` form the
  first two characters differ, and **the last three characters are a checksum, so they differ too**:
  `…Y3ah2goaT` → `…Y3ah2gttW`.
- In non-url-safe base64 the separators `-` and `_` look like `+` and `/` (`x4xa_0kUSh` → `x4xa/0kUSh`). Almost all
  wallets and explorers show the url-safe form.
- **Address poisoning.** Scammers create an address with the same start and end as yours and send you a tiny transfer,
  hoping you copy their address from your history. A memorable ending doesn't protect you; if anything, it teaches people
  to check only the ending. When sending to your own address, compare all of it or take it from the wallet.

## Hunt options

`npm run hunt -- --max-temp 75 --per-hour 6` etc.:

| Flag | Default | Meaning |
|---|---|---|
| `--max-temp` | 80 | target GPU temperature, °C |
| `--save-min` | 150 | minimum score to save to `gems.jsonl`. With the v5-lite sieve, 150 saves ~10 finds/s on a fast card; raise it to 180–200 if the file grows too fast (+10 points ≈ half as many) |
| `--v5t` | save-min − 10 | GPU sieve threshold (0 = old word rules) |
| `--per-hour` | 11 | Telegram messages per hour (best of each slot) |
| `--min-bot` | 100 | minimum score for Telegram |
| `--cap` | 25 | how many addresses to keep per label |
| `--start-every` | 4 | every N-th message is the best one with a word right after `UQ` (0 = off) |
| `--versions` | 1 | wallet versions per key: 1 = W5 only, 4 = W5, V4R2, V3R2, V3R1 (~2.2x more addresses) |

**Thermal protection.** The kernel keeps the temperature itself: it regulates its duty cycle, idles completely at
target+5°C until target−6°C, and stops at target+10°C (never above 90°C) or if the sensor fails. It refuses to run
without NVML (part of the driver). If your card runs hot, raise the fan speed and/or lower the power limit (for example
with MSI Afterburner): the speed barely drops.

**Exact ending** instead of meme addresses:
```
node scripts/kernel.mjs --suffix _durov > hits.txt    (the file contains KEYS; Ctrl+C to stop)
node src/check_hits.mjs hits.txt                       (re-checks with @ton/ton, never prints keys)
```

Kernel service modes (`node scripts/kernel.mjs <mode>`): `selftest <seed file>`, `validate N`,
`stats N` (sieve rule frequencies), `bench N`.

## Telegram (optional)

1. Create a bot with [@BotFather](https://t.me/BotFather) and send it any message.
2. Copy `telegram.config.example.json` → `telegram.config.json` and put in the `token`.
3. `npm run telegram-setup` finds your `chatId`, writes it to the config and sends a test message.

Or set `TG_BOT_TOKEN` and `TG_CHAT_ID`. If Telegram only works through a proxy, set `HTTPS_PROXY`; the Windows system
proxy is picked up automatically.

Buttons: 👍 / 😐 / 👎 go to `data/taste/reactions.jsonl` (material for tuning the score to your taste),
⭐ copies the record with its key to `favorites.jsonl`.

## Tuning the taste

The score is tuned to the author's taste: crypto slang, memes, irony, swearing (English and Russian transliteration).
To make it yours:

- `src/words_curated.mjs` — hand-picked words and favourite themes (they get a bonus). Edit freely.
- `src/gems.mjs` → `SLANG` — slang; `node -e "import('./src/gems.mjs').then(m=>m.writeWordsHeader())"` rebuilds the
  GPU dictionary `cuda/words.h`, then run `npm run setup -- --force`.
- `data/word_votes.json` — the author's votes on words (`1` / `0` / `-1`). Delete it for a more neutral score.
- `src/score_v5.mjs` → `P5` — the weights. How it works: the address is split into words with a frequency dictionary;
  a word's gain = 5 bits × length − the word's frequency cost; plus bonuses for themes, separation (separators,
  letter-case contrast), a phrase at the end, a word after `UQ`, stretched letters, emoticons and meme numbers.

## Files

| Path | What |
|---|---|
| `scripts/setup.mjs` | environment check, build, self-test |
| `cuda/vanity.cu` | the kernel: ed25519 (fixed-base, 16-bit window, batched Montgomery inversion), SHA-256/512, W5/V4R2/V3R2/V3R1 addresses, thermal regulator |
| `cuda/v5lite.inc`, `cuda/v5dict.h` | the v5-lite sieve: the v5 score on the GPU; the dictionary is generated by `src/gpu_dict_v5.mjs` from `src/score_v5.mjs` (setup does it) |
| `cuda/detector_words.inc` | pattern and stretch rules (fast and reference versions), the old word rules |
| `src/recall_sample.mjs`, `src/recall_eval.mjs` | measuring the sieve's recall on random addresses |
| `cuda/words.h`, `base_table.h`, `sha_const.h`, `calib.h`, `calib_multi.h` | generated tables (`src/gems.mjs`, `cuda/gen_*.mjs`, `ref/calib.mjs`) |
| `cuda/tbl16.bin` | the 16-bit window table, 60 MB (`cuda/gen_wtable.mjs`, created by `npm run setup`; not stored in git) |
| `src/run_cuda.mjs` | the wrapper: scoring, saving, Telegram, dashboard |
| `src/score_v5.mjs` | the score: how interesting, good-looking and meme-worthy an address is |
| `src/verify.mjs`, `src/check_hits.mjs` | independent key verification with the official `@ton/ton` |
| `scripts/top.mjs` | viewing finds without keys |
| `web/`, `scripts/*-template.html` | the browser generator and the address checker (`docs/`) |
| `tests/` | automated tests of the score and addresses (`npm test`, no GPU needed) |
| `data/en_zipf.tsv` | English word frequencies |

## Licenses and credits

- Code — [MIT](LICENSE).
- `data/en_zipf.tsv` — derived from [wordfreq](https://github.com/rspeer/wordfreq) (Robyn Speer), data under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); the file is distributed under the same terms.
- [`@ton/ton`, `@ton/core`, `@ton/crypto`](https://github.com/ton-org), [tweetnacl](https://github.com/dchest/tweetnacl-js),
  [noble-curves](https://github.com/paulmillr/noble-curves).
- The "non-randomness" score idea comes from wordninja and DGA-domain detectors.

Use at your own risk. This is not financial advice and not an audited cryptographic product.
