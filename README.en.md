# TON Meme Vanity — funny TON wallet addresses on your GPU

<p align="center"><img src="docs/social-preview.png" alt="UQDurov… — an example of a funny TON address" width="760"></p>

[Русская версия](README.md) · [Generator in your browser — no GPU, no install](https://pkmt-commits.github.io/ton-meme-vanity/generate.html) · [Address checker](https://pkmt-commits.github.io/ton-meme-vanity/) · [AGENTS.md](AGENTS.md) for AI coding agents

A CUDA vanity-address generator for TON wallets. A normal vanity generator looks for one fixed ending (`…_DUROV`).
This one scores **every** address for things a person would not believe are random: readable phrases at the end
(`…NGMI-ser`, `…good_JOB`), a meme word right after `UQ`, stretched words (`Swwwwwwag`), emoticons that stand out by
letter case (`-_-`, `o_O`), meme numbers (`420`, `69`, `67`), "documentation-looking" addresses (`UQABCDEF…`, `UQAAAAAA…`).
The best finds are sent to Telegram. Every key is re-checked with the official `@ton/ton` library before it is saved.

## Quick start

You need an NVIDIA GPU, [Node.js](https://nodejs.org) 20+, the [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads)
and, on Windows, [Build Tools for Visual Studio 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
("Desktop development with C++"). Tested on Windows 11 with an RTX 3080 Ti; Linux should work (the kernel compiles in CI).

```
npm run setup     # checks the toolchain, detects your GPU, builds the kernel, self-tests it against @ton/ton
npm run hunt      # start hunting (Ctrl+C to stop); found keys go to gems.jsonl — never share that file
npm run top       # best addresses found so far, without keys
```

## What makes it different

**Phrases, not a mask.** A fixed mask is practically limited to 6–8 characters: every extra letter costs ~32x more attempts.
Here thousands of words and word pairs count at once, so 2–3-word phrases of 9–12 characters keep turning up:

| Ending | Reads as | Attempts to hit it with a mask | Time with a mask¹ |
|---|---|---|---|
| `…Y3ah2goaT` | yeah 2 goat | ~140 trillion | one to six months |
| `…x4xa_0kUSh` | xaxa kush | ~9,000 trillion | 5 to 35 years |

Both (and the examples below) came from a single 44-second test run. The trade-off: you can't order a specific phrase,
you pick from what turns up. For an exact ending there is a `--suffix` mode.

¹ At 8–60 million addresses per second, a rough range for current NVIDIA cards (`npm run bench` shows yours).

**Raw keys, not 24 words.** A TON key from a 24-word phrase costs 100,000 PBKDF2-HMAC-SHA512 iterations (and only ~1 in 256
random phrases is valid), so phrase-based generators are roughly 1000x slower. Here raw ed25519 seeds are searched: one SHA-256,
one SHA-512 and one curve multiplication per key (16 point additions with a 60 MB table in GPU memory).

**Four addresses per key.** The address depends on the wallet contract version as well as the key. With `--versions 4`
every key is checked as a **W5, V4R2, V3R2 and V3R1** wallet. An extra version costs two SHA-256 instead of another curve
multiplication, so you get ~2.2x more addresses per second. MyTonWallet lists all four versions of an imported key
(Settings → Wallet Versions) — importing all four was tested by hand (October 2026). The default is W5 only, the newest version (e.g. it can pay fees in USDT).

## How it works

```
cuda/vanity  (GPU: ed25519 seed → pubkey → wallet address(es) → the v5 score itself on the GPU ("v5-lite"))
   └─ prints "HIT <seedHex> <address> <version>"
src/run_cuda.mjs (wrapper + dashboard)
   ├─ scoreV5(address) — the exact score
   ├─ score ≥ --save-min → key re-checked with official @ton/ton → gems.jsonl (WITH THE KEY)
   └─ best of each time slot → Telegram (address ONLY) → ⭐ button → favorites.jsonl
```

**The GPU computes the score itself.** Earlier versions used separate GPU "word rules" that only loosely resembled the
score; measured on 200 million random addresses they passed only ~25% of the addresses the score rates 150+ (they missed
3-letter words split by letter case like `scamKEK`, mixed case like `RugWEeD`, and knew 7k words instead of ~47k). The
v5-lite sieve runs the same segmentation, dictionary and weights on the GPU: it matches the exact score within ±2 points
for 96–99% of addresses and keeps 99% of the good ones at the same speed — about 4x more good finds.

The score is "how much less random than noise" in bits: the address is split into words by English word frequency
(wordfreq); every random character is 5 bits of noise, a word "saves" bits if it is cheaper than its length. Bonuses go
to separation (`-`, `_`, letter-case contrast), a phrase at the end, a word right after `UQ`, stretched letters, emoticons
and meme numbers. Score = bits × 10, so **+10 points ≈ half as likely**.

Example `npm run top` (addresses from a test run; their keys were destroyed — do not send money there):

```
  227  T1:aaaaass                  UQBHZEO8PZ60426yiseuBbJBfSoICVT7TWBuMzW-Baaaaass
  215  T2:Y3ah_goaT                UQC5PS0DCjuLHTFvAy-2WB3TfV5utOrqSHWmBNxY3ah2goaT
  198  T2:x4xa_kUSh                UQDzdCq-qAR68Lq6KvweGQNDBsYUSVHSo96d25x4xa_0kUSh
  191  TS:BLyA_…_poor              UQBLyA25xBc6o4Xwq7ZqJvtQ3HDPsgd4xiOXS7xtf219poor
  190  TM:butt4                    UQBUTTTTqcNR3XnNdRr_kWZyjMbZYYTCdkRNevbpAQQ7G7qP
```

Labels: `T1` one word plus a rarity (stretch, repeats), `T2` a word pair at the end, `T3` three or more words,
`TS` a word right after `UQ` plus an ending, `TM` a stretched word anywhere.

## What is verified

| Check | How |
|---|---|
| The kernel computes pubkey and address exactly like `@ton/ton` (20 test seeds × 4 wallet versions, with and without the table) | `npm run selftest` (part of setup) |
| The fast GPU word detector equals the reference one on millions of addresses | `node scripts/kernel.mjs validate 15` |
| The fast Node address path equals `@ton/ton` on 3,000 random seeds | `npm run smoke` |
| Every saved key | re-checked with `@ton/ton` before writing; mismatches are shown on the dashboard (must be 0) |
| Your GPU speed | `npm run bench` |

## Security — please read

- **Keys are created and stay on your machine.** Only the address goes to the network (Telegram).
- **`gems.jsonl` and `favorites.jsonl` contain private keys** (`seedHex`, `secretKeyHex`). Never show, commit, paste into chats
  or AI assistants. To look at your finds safely use `npm run top`, it prints addresses only.
- **How a key is made.** Seed = `SHA-256(base ‖ counter)`, the base is 32 bytes from the OS CSPRNG (`std::random_device`:
  `RtlGenRandom` on Windows), the counter is 64-bit. Leaking one key says nothing about the others. Randomness now comes
  straight from the OS (`BCryptGenRandom` / `getrandom`) with sanity checks.
- **GPU memory.** CUDA does not clear memory between processes (`cudaMalloc`: "The memory is not cleared"). The kernel wipes
  found seeds right after handing them over and the base on exit; after a forced kill the last base may stay in VRAM until
  reboot — reboot after hunting on a shared machine.
- **History (before publication, fixed):** early versions seeded from a 32-bit number (`mt19937`) — the same class of bug as
  Profanity (the 2022 Wintermute hack), and later used `counter ‖ base` directly, so one leaked key exposed its neighbours.
- **Address poisoning.** Scammers create an address with the same start and end as yours and send you a tiny transfer, hoping
  you copy their address from history. A memorable ending makes people check only the ending. Compare the whole address.
- The last three characters of a TON address are a checksum and depend on the form: in the bounceable `EQ…` form a funny
  ending changes (`…Y3ah2goaT` → `…Y3ah2gttW`). Wallets show wallet addresses in the `UQ…` form.

## Importing a found wallet

The key is a raw seed; there are no 24 words. Tested with **MyTonWallet** (October 2026):

1. Add wallet → **Import from Secret Words**.
2. Paste the record's `seedHex` (64 hex characters) into the **first word** field. No spaces or line breaks.
3. The wallet must show **exactly the same address**. Compare it character by character before sending funds.
Clipboard: a copied seed stays in Windows clipboard history (Win+V) and, with "Sync across devices" on, goes to the Microsoft
cloud; phone keyboards remember pasted text too. Clear the history after importing (Win+V → Clear all).
4. If the record's `ver` is not `W5` (hunting with `--versions 4`): open **Settings → Wallet Versions** and pick that version.

## Hunt options

`npm run hunt -- --max-temp 75 --per-hour 6` etc.

| Flag | Default | Meaning |
|---|---|---|
| `--max-temp` | 80 | target GPU temperature, °C |
| `--save-min` | 150 | minimum score to save to `gems.jsonl`. With the v5-lite sieve, 150 saves ~10 finds/s on a fast card — raise to 180–200 if the file grows too fast (+10 points ≈ half as many) |
| `--v5t` | save-min − 10 | GPU sieve threshold (0 = old word rules) |
| `--per-hour` | 11 | Telegram messages per hour (best of each slot) |
| `--min-bot` | 100 | minimum score for Telegram |
| `--cap` | 25 | how many addresses to keep per label |
| `--start-every` | 4 | every N-th message is the best with a word right after `UQ` (0 = off) |
| `--versions` | 1 | wallet versions per key: 1 = W5 only, 4 = W5, V4R2, V3R2, V3R1 |

**Thermal protection.** The kernel keeps the temperature itself: it regulates its duty cycle, idles completely at target+5°C
until target−6°C, and stops at target+10°C (never above 90°C) or if the sensor fails. It refuses to run without NVML.

**Exact ending** instead of funny addresses:
```
node scripts/kernel.mjs --suffix _durov > hits.txt    (the file contains KEYS; Ctrl+C to stop)
node src/check_hits.mjs hits.txt                       (re-checks with @ton/ton, never prints keys)
```

## Telegram (optional)

1. Create a bot with [@BotFather](https://t.me/BotFather) and send it any message.
2. Copy `telegram.config.example.json` → `telegram.config.json`, put in the `token`.
3. `npm run telegram-setup` finds your `chatId`, writes it to the config and sends a test message.

Or set `TG_BOT_TOKEN` and `TG_CHAT_ID`. Behind a proxy: `HTTPS_PROXY` or the Windows system proxy (picked up automatically).
Buttons: 👍 / 😐 / 👎 go to `data/taste/reactions.jsonl` (material for tuning the score), ⭐ copies the record with its key
to `favorites.jsonl`.

## Tuning the taste

The score is tuned to the author's taste: crypto slang, memes, swearing (English and Russian transliteration), irony.

- `src/words_curated.mjs` — hand-picked words and favourite themes (bonus). Edit freely.
- `src/gems.mjs` → `SLANG`; then `node -e "import('./src/gems.mjs').then(m=>m.writeWordsHeader())"` rebuilds the GPU dictionary
  `cuda/words.h`, then `npm run setup -- --force`.
- `data/word_votes.json` — the author's word votes (`1` / `0` / `-1`). Delete it for a more neutral score.
- `src/score_v5.mjs` → `P5` — the weights.

## Licenses and credits

- Code — [MIT](LICENSE).
- `data/en_zipf.tsv` — derived from [wordfreq](https://github.com/rspeer/wordfreq) (Robyn Speer), data under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); the file is distributed under the same terms.
- [`@ton/ton`, `@ton/core`, `@ton/crypto`](https://github.com/ton-org), [tweetnacl](https://github.com/dchest/tweetnacl-js),
  [noble-curves](https://github.com/paulmillr/noble-curves).
- The "non-randomness" score idea comes from wordninja and DGA-domain detectors.

Use at your own risk. This is not financial advice and not an audited cryptographic product.
